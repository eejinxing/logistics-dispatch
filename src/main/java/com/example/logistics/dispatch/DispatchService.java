package com.example.logistics.dispatch;

import com.example.logistics.common.BusinessException;
import com.example.logistics.common.CodeGenerator;
import com.example.logistics.common.NotFoundException;
import com.example.logistics.concurrent.Bulkhead;
import com.example.logistics.concurrent.BulkheadRegistry;
import com.example.logistics.concurrent.KeyedLocks;
import com.example.logistics.concurrent.SingleFlight;
import com.example.logistics.concurrent.Throwables;
import com.example.logistics.config.SimulationProperties;
import com.example.logistics.dispatch.AutoDispatchResult.HubOutcome;
import com.example.logistics.dispatch.AutoDispatchResult.VehicleNeed;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.hub.RoutePlanner;
import com.example.logistics.hub.Routes;
import com.example.logistics.live.LiveEvent;
import com.example.logistics.live.LiveEventHub;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentJournal;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.simulation.SimulationClock;
import com.example.logistics.vehicle.Vehicle;
import com.example.logistics.vehicle.VehicleRepository;
import com.example.logistics.vehicle.VehicleStatus;
import com.example.logistics.vehicle.VehicleType;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

import static com.example.logistics.config.ExecutorConfig.IO_EXECUTOR;

@Service
public class DispatchService {
    private static final Logger log = LoggerFactory.getLogger(DispatchService.class);
    private static final String BULKHEAD = "dispatch";
    private static final Duration RELOCATION_PREP = Duration.ofMinutes(10);
    private static final long AUTO_TIMEOUT_SECONDS = 30;

    private final HubRepository hubs;
    private final VehicleRepository vehicles;
    private final ShipmentRepository shipments;
    private final TripRepository trips;
    private final ShipmentJournal journal;
    private final CodeGenerator codes;
    private final SimulationClock clock;
    private final SimulationProperties sim;
    private final KeyedLocks<Long> hubLocks;
    private final TransactionTemplate tx;
    private final BulkheadRegistry bulkheads;
    private final Executor ioExecutor;
    private final LiveEventHub live;
    private final RoutePlanner routes;
    private final Counter tripsCreated;
    private final SingleFlight<String, AutoDispatchResult> autoRuns = new SingleFlight<>();

    public DispatchService(HubRepository hubs, VehicleRepository vehicles, ShipmentRepository shipments,
                           TripRepository trips, ShipmentJournal journal, CodeGenerator codes, SimulationClock clock,
                           SimulationProperties sim, KeyedLocks<Long> hubLocks, TransactionTemplate tx,
                           BulkheadRegistry bulkheads, @Qualifier(IO_EXECUTOR) Executor ioExecutor,
                           LiveEventHub live, RoutePlanner routes, MeterRegistry metrics) {
        this.routes = routes;
        this.hubs = hubs;
        this.vehicles = vehicles;
        this.shipments = shipments;
        this.trips = trips;
        this.journal = journal;
        this.codes = codes;
        this.clock = clock;
        this.sim = sim;
        this.hubLocks = hubLocks;
        this.tx = tx;
        this.bulkheads = bulkheads;
        this.ioExecutor = ioExecutor;
        this.live = live;
        this.tripsCreated = Counter.builder("dispatch.trips.created").register(metrics);
    }


    @Transactional(readOnly = true)
    public List<LaneView> pendingLanes() {
        Instant now = clock.instant();
        Hub gateway = routes.gateway().orElse(null);
        Map<String, List<Shipment>> byLane = new LinkedHashMap<>();
        Map<String, Hub> nextHops = new HashMap<>();
        for (Shipment s : shipments.findAllWaiting(ShipmentStatus.WAITING)) {
            Hub next = RoutePlanner.nextHop(s.getCurrentHub(), s.getDestination(), gateway);
            String key = s.getCurrentHub().getId() + ">" + next.getId();
            byLane.computeIfAbsent(key, k -> new ArrayList<>()).add(s);
            nextHops.putIfAbsent(key, next);
        }
        return byLane.entrySet().stream()
                .map(e -> LaneView.of(e.getValue(), nextHops.get(e.getKey()), now, sim.consolidationWait()))
                .sorted(Comparator.comparing(LaneView::overdue).reversed()
                        .thenComparing(LaneView::waitingSince))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<TripView> activeTrips() {
        return trips.findWithDetailsByStatusIn(EnumSet.of(TripStatus.LOADING, TripStatus.IN_TRANSIT)).stream()
                .map(t -> TripView.from(t, t.getShipments().size()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<TripView> recentArrivals(int limit) {
        return trips.findRecentlyArrived(PageRequest.of(0, Math.clamp(limit, 1, 100))).stream()
                .map(t -> TripView.from(t, t.getShipments().size()))
                .toList();
    }


    public TripView dispatch(DispatchRequest request) {
        long hubId = currentHubOf(request.vehicleId());
        return hubLocks.withLock(hubId, () -> tx.execute(status -> manualDispatch(request, hubId)));
    }

    private TripView manualDispatch(DispatchRequest request, long hubId) {
        Instant now = clock.instant();
        Vehicle vehicle = vehicles.findById(request.vehicleId())
                .orElseThrow(() -> new NotFoundException("Vehicle not found: " + request.vehicleId()));
        if (!vehicle.getHub().getId().equals(hubId)) {
            throw new BusinessException("Vehicle " + vehicle.getPlateNo() + " has moved. Refresh and try again.");
        }
        if (vehicle.getStatus() != VehicleStatus.IDLE) {
            throw new BusinessException("Vehicle " + vehicle.getPlateNo() + " is currently \"" + vehicle.getStatus().label() + "\". It cannot be dispatched.");
        }

        Set<Long> ids = new LinkedHashSet<>(request.shipmentIds());
        List<Shipment> load = shipments.findAllWithDetails(ids);
        if (load.size() != ids.size()) {
            throw new NotFoundException("One or more shipments could not be found");
        }
        Hub origin = vehicle.getHub();
        Hub gateway = routes.gateway().orElse(null);
        Hub destination = null;
        for (Shipment s : load) {
            if (!s.getStatus().isWaiting()) {
                throw new BusinessException("Shipment " + s.getTrackingNo() + " is currently \"" + s.getStatus().label()
                        + "\". Another operator may have assigned it.");
            }
            if (!s.getCurrentHub().getId().equals(hubId)) {
                throw new BusinessException("Shipment " + s.getTrackingNo() + " is not at the vehicle hub " + origin.getCode());
            }
            Hub next = RoutePlanner.nextHop(s.getCurrentHub(), s.getDestination(), gateway);
            if (destination == null) {
                destination = next;
            } else if (!destination.getId().equals(next.getId())) {
                throw new BusinessException("A trip can serve one next stop. Dispatch each route separately.");
            }
        }
        if (!Routes.canServe(vehicle.getType(), origin, destination)) {
            throw new BusinessException(Routes.requiresAir(origin, destination)
                    ? "Routes between Peninsular and East Malaysia require a cargo aircraft" : "Cargo aircraft serve routes between Peninsular and East Malaysia");
        }
        double kg = load.stream().mapToDouble(Shipment::getWeightKg).sum();
        if (kg > vehicle.getCapacityKg()) {
            throw new BusinessException(String.format("Over capacity: %.0f kg exceeds the %s capacity of %d kg",
                    kg, vehicle.getPlateNo(), vehicle.getCapacityKg()));
        }
        Trip trip = createTrip(vehicle, origin, destination, load, false, now);
        return TripView.from(trip, load.size());
    }

    public TripView relocate(long vehicleId, long targetHubId) {
        long hubId = currentHubOf(vehicleId);
        return hubLocks.withLock(hubId, () -> tx.execute(status -> {
            Vehicle vehicle = vehicles.findById(vehicleId)
                    .orElseThrow(() -> new NotFoundException("Vehicle not found: " + vehicleId));
            if (!vehicle.getHub().getId().equals(hubId) || vehicle.getStatus() != VehicleStatus.IDLE) {
                throw new BusinessException("Only idle vehicles can be relocated. " + vehicle.getPlateNo() + " is currently \""
                        + vehicle.getStatus().label() + "\"");
            }
            Hub target = hubs.findById(targetHubId)
                    .orElseThrow(() -> new NotFoundException("Hub not found: " + targetHubId));
            if (target.getId().equals(hubId)) {
                throw new BusinessException("The vehicle is already at " + target.getCode());
            }
            if (!vehicle.getType().isAir() && vehicle.getHub().getLandmass() != target.getLandmass()) {
                throw new BusinessException("Road vehicles cannot be relocated across the sea");
            }
            Trip trip = createTrip(vehicle, vehicle.getHub(), target, List.of(), true, clock.instant());
            return TripView.from(trip, 0);
        }));
    }


    public CompletableFuture<AutoDispatchResult> autoDispatch() {
        return autoRuns.run("auto", this::runAutoDispatch);
    }

    private CompletableFuture<AutoDispatchResult> runAutoDispatch() {
        long started = System.nanoTime();
        List<Long> hubIds = shipments.findHubIdsWithWaiting(ShipmentStatus.WAITING);
        if (hubIds.isEmpty()) {
            return CompletableFuture.completedFuture(AutoDispatchResult.empty(clock.instant()));
        }

        Bulkhead bulkhead = bulkheads.get(BULKHEAD);
        Queue<Long> queue = new ConcurrentLinkedQueue<>(hubIds);
        int workers = Math.min(bulkhead.maxConcurrent(), hubIds.size());
        List<CompletableFuture<List<HubOutcome>>> futures = new ArrayList<>(workers);
        for (int i = 0; i < workers; i++) {
            futures.add(bulkhead.submit(ioExecutor, () -> drain(queue))
                    .exceptionally(e -> List.of(HubOutcome.failed(-1, "worker",
                            "Dispatch task was rejected: " + Throwables.unwrap(e).getMessage()))));
        }

        return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
                .thenApply(ignored -> {
                    List<HubOutcome> outcomes = futures.stream().flatMap(f -> f.join().stream()).toList();
                    List<String> relocations = relocateForNeeds(outcomes);
                    long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
                    AutoDispatchResult result = AutoDispatchResult.of(clock.instant(), hubIds.size(), workers,
                            outcomes, relocations, elapsedMs);
                    announce(result);
                    return result;
                })
                .orTimeout(AUTO_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private List<HubOutcome> drain(Queue<Long> queue) {
        List<HubOutcome> outcomes = new ArrayList<>();
        Long next;
        while ((next = queue.poll()) != null) {
            long hubId = next;
            try {
                outcomes.add(hubLocks.withLock(hubId, () -> tx.execute(status -> planHub(hubId))));
            } catch (RuntimeException e) {
                log.warn("auto-dispatch for hub {} failed: {}", hubId, e.toString());
                outcomes.add(HubOutcome.failed(hubId, "#" + hubId, describe(e)));
            }
        }
        return outcomes;
    }

    private HubOutcome planHub(long hubId) {
        Instant now = clock.instant();
        Hub hub = hubs.findById(hubId).orElseThrow(() -> new NotFoundException("Hub not found: " + hubId));
        List<Shipment> pending = shipments.findWaitingAt(hubId, ShipmentStatus.WAITING);
        List<Vehicle> idle = new ArrayList<>(vehicles.findAtHub(hubId, VehicleStatus.IDLE));
        HubOutcome outcome = new HubOutcome(hubId, hub.getCode(), new ArrayList<>(), new ArrayList<>(),
                new ArrayList<>(), null);

        Hub gateway = routes.gateway().orElse(null);
        Map<Long, Hub> nextHops = new HashMap<>();
        Map<Long, List<Shipment>> byNextHop = new LinkedHashMap<>();
        for (Shipment s : pending) {
            Hub next = RoutePlanner.nextHop(hub, s.getDestination(), gateway);
            nextHops.putIfAbsent(next.getId(), next);
            byNextHop.computeIfAbsent(next.getId(), k -> new ArrayList<>()).add(s);
        }
        List<Long> order = new ArrayList<>(byNextHop.keySet());
        order.sort(Comparator.comparing((Long id) -> byNextHop.get(id).stream().noneMatch(DispatchService::isExpress))
                .thenComparing(id -> byNextHop.get(id).getFirst().getStatusChangedAt()));
        for (Long nextId : order) {
            planLane(hub, nextHops.get(nextId), byNextHop.get(nextId), idle, outcome, now);
        }
        return outcome;
    }

    private void planLane(Hub hub, Hub destination, List<Shipment> lane, List<Vehicle> idle, HubOutcome outcome,
                          Instant now) {
        boolean air = Routes.requiresAir(hub, destination);
        String laneName = hub.getCode() + "→" + destination.getCode();

        List<Shipment> remaining = new ArrayList<>(lane);
        remaining.sort(Comparator.comparing((Shipment s) -> !isExpress(s)).thenComparing(Shipment::getStatusChangedAt));

        while (!remaining.isEmpty()) {
            boolean overdue = DispatchRules.isOverdue(remaining, now, sim.consolidationWait());
            List<Vehicle> candidates = idle.stream().filter(v -> Routes.canServe(v.getType(), hub, destination)).toList();
            double laneKg = remaining.stream().mapToDouble(Shipment::getWeightKg).sum();
            if (candidates.isEmpty()) {
                if (overdue) {
                    outcome.needs().add(new VehicleNeed(hub.getId(), hub.getCode(), air, laneName));
                }
                outcome.waiting().add(String.format("%s waiting for %s (%d shipments, %.0f kg)", laneName,
                        air ? "a cargo aircraft" : "an idle vehicle", remaining.size(), laneKg));
                return;
            }
            Vehicle vehicle = DispatchRules.chooseVehicle(candidates, laneKg, overdue, sim.fillThreshold());
            if (vehicle == null) {
                outcome.waiting().add(String.format("%s consolidating (%d shipments, %.0f kg)", laneName, remaining.size(), laneKg));
                return;
            }
            List<Shipment> load = new ArrayList<>();
            double kg = 0;
            for (Shipment s : remaining) {
                if (kg + s.getWeightKg() <= vehicle.getCapacityKg()) {
                    load.add(s);
                    kg += s.getWeightKg();
                }
            }
            if (load.isEmpty()) {
                outcome.waiting().add(laneName + " contains a shipment that exceeds available vehicle capacity");
                return;
            }
            Trip trip = createTrip(vehicle, hub, destination, load, false, now);
            outcome.trips().add(TripView.from(trip, load.size()));
            idle.remove(vehicle);
            remaining.removeAll(load);
        }
    }

    private List<String> relocateForNeeds(List<HubOutcome> outcomes) {
        Map<String, VehicleNeed> needs = new LinkedHashMap<>();
        outcomes.forEach(o -> o.needs().forEach(n -> needs.putIfAbsent(spareKey(n.hubId(), n.air()), n)));
        if (needs.isEmpty()) {
            return List.of();
        }
        List<Vehicle> idle = vehicles.findByStatusWithHub(VehicleStatus.IDLE);
        Map<String, Integer> spare = new HashMap<>();
        for (Vehicle v : idle) {
            spare.merge(spareKey(v.getHub().getId(), v.getType().isAir()), 1, Integer::sum);
        }
        Hub gateway = routes.gateway().orElse(null);
        Set<String> lanes = new HashSet<>();
        for (Shipment s : shipments.findAllWaiting(ShipmentStatus.WAITING)) {
            Hub next = RoutePlanner.nextHop(s.getCurrentHub(), s.getDestination(), gateway);
            if (lanes.add(s.getCurrentHub().getId() + ">" + next.getId())) {
                spare.merge(spareKey(s.getCurrentHub().getId(), Routes.requiresAir(s.getCurrentHub(), next)), -1,
                        Integer::sum);
            }
        }

        List<String> done = new ArrayList<>();
        for (VehicleNeed need : needs.values()) {
            Set<VehicleType> types = need.air() ? EnumSet.of(VehicleType.AIR_CARGO)
                    : EnumSet.complementOf(EnumSet.of(VehicleType.AIR_CARGO));
            if (trips.relocationUnderway(need.hubId(), types)) {
                continue;
            }
            try {
                relocateOne(need, idle, spare).ifPresent(done::add);
            } catch (RuntimeException e) {
                log.warn("relocation to {} failed: {}", need.hubCode(), e.toString());
            }
        }
        return done;
    }

    private static String spareKey(long hubId, boolean air) {
        return hubId + ":" + air;
    }

    private Optional<String> relocateOne(VehicleNeed need, List<Vehicle> idle, Map<String, Integer> spare) {
        Hub target = hubs.findById(need.hubId()).orElseThrow();
        Optional<Vehicle> candidate = idle.stream()
                .filter(v -> v.getType().isAir() == need.air())
                .filter(v -> !v.getHub().getId().equals(target.getId()))
                .filter(v -> spare.getOrDefault(spareKey(v.getHub().getId(), need.air()), 0) > 0)
                .filter(v -> need.air() || v.getHub().getLandmass() == target.getLandmass())
                .min(Comparator.comparingDouble(v -> v.getHub().greatCircleKmTo(target)));
        if (candidate.isEmpty()) {
            return Optional.empty();
        }
        Vehicle picked = candidate.get();
        idle.remove(picked);
        spare.merge(spareKey(picked.getHub().getId(), need.air()), -1, Integer::sum);
        long fromHubId = picked.getHub().getId();
        return Optional.ofNullable(hubLocks.withLock(fromHubId, () -> tx.execute(status -> {
            Vehicle v = vehicles.findById(picked.getId()).orElseThrow();
            if (v.getStatus() != VehicleStatus.IDLE || !v.getHub().getId().equals(fromHubId)) {
                return null;
            }
            Hub from = v.getHub();
            Hub to = hubs.findById(target.getId()).orElseThrow();
            createTrip(v, from, to, List.of(), true, clock.instant());
            return v.getPlateNo() + " " + from.getCode() + " → " + to.getCode()
                    + " (" + need.lane() + " needs " + (need.air() ? "a cargo aircraft" : "a vehicle") + ")";
        })));
    }


    private Trip createTrip(Vehicle vehicle, Hub origin, Hub destination, List<Shipment> load, boolean relocation,
                            Instant now) {
        double km = Routes.distanceKm(origin, destination);
        double kg = load.stream().mapToDouble(Shipment::getWeightKg).sum();
        Instant departAt = now.plus(relocation ? RELOCATION_PREP : sim.loadingTime());
        Instant arriveAt = departAt.plus(Routes.travelTime(km, vehicle.getType()));

        vehicle.startTrip();
        Trip trip = trips.save(new Trip(codes.nextTripCode(), vehicle, origin, destination, relocation, kg, km, now,
                departAt, arriveAt));
        for (Shipment s : load) {
            s.assignTo(trip, now);
            trip.getShipments().add(s);
            String via = s.getDestination().sameAs(destination) ? ""
                    : ", via " + destination.getCode() + " with onward service to " + s.getDestination().getCode();
            journal.record(s, origin.getName(), "Loaded · " + vehicle.getPlateNo() + " (" + vehicle.getType().label()
                    + ") · Trip " + trip.getCode() + via, now);
        }
        tripsCreated.increment();
        String message = relocation
                ? "Empty relocation " + trip.getCode() + " · " + vehicle.getPlateNo() + " · " + origin.getCode() + " → " + destination.getCode()
                : String.format("New trip %s · %s → %s · %s · %d shipments, %.0f kg", trip.getCode(), origin.getCode(),
                destination.getCode(), vehicle.getPlateNo(), load.size(), kg);
        live.publishAfterCommit(LiveEvent.info("trip", message,
                Map.of("tripCode", trip.getCode(), "event", "created"), now));
        return trip;
    }

    private void announce(AutoDispatchResult result) {
        if (result.tripsCreated() == 0 && result.relocations().isEmpty()) {
            return;
        }
        String message = String.format("Auto dispatch: %d hubs processed in parallel, %d trips created, %d shipments loaded%s (%d ms)",
                result.hubsScanned(), result.tripsCreated(), result.shipmentsAssigned(),
                result.relocations().isEmpty() ? "" : ", empty relocations: " + result.relocations().size() + " vehicles",
                result.elapsedMs());
        live.publish(LiveEvent.success("dispatch", message,
                Map.of("trips", result.tripsCreated(), "shipments", result.shipmentsAssigned()), result.at()));
    }

    private long currentHubOf(long vehicleId) {
        Long hubId = tx.execute(status -> vehicles.findById(vehicleId)
                .map(v -> v.getHub().getId())
                .orElseThrow(() -> new NotFoundException("Vehicle not found: " + vehicleId)));
        if (hubId == null) {
            throw new NotFoundException("Vehicle not found: " + vehicleId);
        }
        return hubId;
    }

    private static boolean isExpress(Shipment s) {
        return s.getPriority() == Priority.EXPRESS;
    }

    private static String describe(RuntimeException e) {
        if (e instanceof OptimisticLockingFailureException) {
            return "Data changed during dispatch. The next run will retry.";
        }
        return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    }
}
