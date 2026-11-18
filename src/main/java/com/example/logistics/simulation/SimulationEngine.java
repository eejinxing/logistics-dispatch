package com.example.logistics.simulation;

import com.example.logistics.concurrent.KeyedLocks;
import com.example.logistics.config.SimulationProperties;
import com.example.logistics.dispatch.DispatchService;
import com.example.logistics.dispatch.Trip;
import com.example.logistics.dispatch.TripRepository;
import com.example.logistics.dispatch.TripStatus;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.live.LiveEvent;
import com.example.logistics.live.LiveEventHub;
import com.example.logistics.merchant.Merchant;
import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.seed.FakeData;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentJournal;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentService;
import com.example.logistics.shipment.ShipmentStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Component
@ConditionalOnProperty(prefix = "app.simulation", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SimulationEngine {
    private static final Logger log = LoggerFactory.getLogger(SimulationEngine.class);
    private static final int MAX_STEPS_PER_TICK = 200;
    private static final int MAX_NEW_ORDERS_PER_TICK = 20;
    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("MM-dd HH:mm");
    private static final List<String> ROAD_DELAYS = List.of("Highway traffic", "Wet roads after heavy rain", "Checkpoint queue", "Minor vehicle fault repaired", "Toll plaza congestion");
    private static final List<String> AIR_DELAYS = List.of("Flight delay", "Weather delayed departure", "Airport cargo terminal queue");
    private static final List<String> DELIVERY_FAILURES = List.of("Recipient unavailable", "Incomplete address", "Recipient refused delivery", "Damaged packaging", "No answer by phone");

    private final SimulationClock clock;
    private final SimulationSettings settings;
    private final SimulationProperties props;
    private final TripRepository trips;
    private final ShipmentRepository shipments;
    private final HubRepository hubs;
    private final ShipmentService shipmentService;
    private final DispatchService dispatch;
    private final ShipmentJournal journal;
    private final KeyedLocks<Long> hubLocks;
    private final TransactionTemplate tx;
    private final LiveEventHub live;
    private final MerchantRepository merchants;
    private final Random rnd = new Random();

    private Instant lastTick;
    private Instant lastAutoDispatch;
    private double orderBacklog;

    public SimulationEngine(SimulationClock clock, SimulationSettings settings, SimulationProperties props,
                            TripRepository trips, ShipmentRepository shipments, HubRepository hubs,
                            ShipmentService shipmentService, DispatchService dispatch, ShipmentJournal journal,
                            KeyedLocks<Long> hubLocks, TransactionTemplate tx, LiveEventHub live,
                            MerchantRepository merchants) {
        this.merchants = merchants;
        this.clock = clock;
        this.settings = settings;
        this.props = props;
        this.trips = trips;
        this.shipments = shipments;
        this.hubs = hubs;
        this.shipmentService = shipmentService;
        this.dispatch = dispatch;
        this.journal = journal;
        this.hubLocks = hubLocks;
        this.tx = tx;
        this.live = live;
    }

    @Scheduled(fixedDelay = 1000, initialDelay = 3000)
    public void tick() {
        Instant now = clock.instant();
        Instant previous = lastTick == null ? now : lastTick;
        lastTick = now;
        boolean advanced = now.isAfter(previous);
        if (!advanced && clock.isPaused()) {
            return;
        }
        step("departures", () -> departDueTrips(now));
        step("arrivals", () -> arriveDueTrips(now));
        step("last-mile", () -> advanceLastMile(now));
        if (advanced) {
            step("late-alerts", () -> alertNewlyLate(previous, now));
            if (settings.autoGenerate()) {
                step("new-orders", () -> generateOrders(Duration.between(previous, now)));
            }
        }
        if (settings.autoDispatch()) {
            step("auto-dispatch", () -> maybeAutoDispatch(now));
        }
    }

    private void step(String name, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException e) {
            log.warn("simulation step '{}' failed: {}", name, e.toString());
        }
    }


    private void departDueTrips(Instant now) {
        for (Object[] row : trips.findDueToDepart(TripStatus.LOADING, now)) {
            long tripId = (Long) row[0];
            long originId = (Long) row[1];
            step("depart " + tripId, () -> hubLocks.withLock(originId, () -> tx.executeWithoutResult(s -> depart(tripId))));
        }
    }

    private void depart(long tripId) {
        Trip trip = trips.findWithDetails(tripId).orElse(null);
        if (trip == null || trip.getStatus() != TripStatus.LOADING) {
            return;
        }
        Instant now = clock.instant();
        Hub origin = trip.getOrigin();
        Hub destination = trip.getDestination();
        trip.depart();

        boolean air = trip.getVehicle().getType().isAir();
        if (!trip.isRelocation() && rnd.nextDouble() < props.delayRate()) {
            Duration delay = Duration.ofMinutes(rnd.nextInt(60, 240));
            String reason = FakeData.pick(air ? AIR_DELAYS : ROAD_DELAYS, rnd);
            trip.delay(delay, reason);
            live.publishAfterCommit(LiveEvent.warn("alert", String.format("Trip %s (%s → %s) is expected to be delayed by %.1f hours: %s",
                            trip.getCode(), origin.getCode(), destination.getCode(), delay.toMinutes() / 60.0, reason),
                    Map.of("tripCode", trip.getCode(), "event", "delayed"), now));
        }
        String eta = HHMM.format(trip.getArriveAt().atZone(clock.getZone()));
        for (Shipment s : trip.getShipments()) {
            if (s.getStatus() == ShipmentStatus.ASSIGNED) {
                s.moveTo(ShipmentStatus.IN_TRANSIT, now);
                journal.record(s, origin.getName(), "Departed " + origin.getCode() + " for " + destination.getCode()
                        + ", ETA " + eta + (trip.getDelayReason() == null ? "" : " (" + trip.getDelayReason() + ")"), now);
            }
        }
        live.publishAfterCommit(LiveEvent.info("trip", String.format("Trip %s departed · %s → %s · %s%s", trip.getCode(),
                        origin.getCode(), destination.getCode(), trip.getVehicle().getPlateNo(), trip.isRelocation() ? " (empty)" : ""),
                Map.of("tripCode", trip.getCode(), "event", "departed"), now));
    }

    private void arriveDueTrips(Instant now) {
        for (Object[] row : trips.findDueToArrive(TripStatus.IN_TRANSIT, now)) {
            long tripId = (Long) row[0];
            long destinationId = (Long) row[1];
            step("arrive " + tripId, () -> hubLocks.withLock(destinationId, () -> tx.executeWithoutResult(s -> arrive(tripId))));
        }
    }

    private void arrive(long tripId) {
        Trip trip = trips.findWithDetails(tripId).orElse(null);
        if (trip == null || trip.getStatus() != TripStatus.IN_TRANSIT) {
            return;
        }
        Instant now = clock.instant();
        Hub destination = trip.getDestination();
        trip.arrive(now);
        trip.getVehicle().finishTrip(destination);
        int unloaded = 0;
        int transfers = 0;
        for (Shipment s : trip.getShipments()) {
            if (s.getStatus() == ShipmentStatus.IN_TRANSIT) {
                s.arriveAt(destination, now);
                if (s.getStatus() == ShipmentStatus.ARRIVED_HUB) {
                    s.scheduleNextStep(now.plus(Duration.ofMinutes(rnd.nextInt(60, 180))));
                    journal.record(s, destination.getName(), "Arrived at " + destination.getCode() + " hub for sorting", now);
                } else {
                    journal.record(s, destination.getName(), "Arrived at " + destination.getCode() + " transfer hub, awaiting onward service to "
                            + s.getDestination().getCode(), now);
                    transfers++;
                }
                unloaded++;
            }
        }
        String message = trip.isRelocation()
                ? String.format("Trip %s arrived at %s (empty relocation) · %s is available", trip.getCode(), destination.getCode(), trip.getVehicle().getPlateNo())
                : String.format("Trip %s arrived at %s · unloaded %d shipments%s", trip.getCode(), destination.getCode(), unloaded,
                transfers > 0 ? " (" + transfers + " for transfer)" : "");
        live.publishAfterCommit(LiveEvent.success("trip", message,
                Map.of("tripCode", trip.getCode(), "event", "arrived"), now));
    }


    private void advanceLastMile(Instant now) {
        List<Long> due = shipments.findDueSteps(EnumSet.of(ShipmentStatus.ARRIVED_HUB, ShipmentStatus.OUT_FOR_DELIVERY),
                now, PageRequest.of(0, MAX_STEPS_PER_TICK));
        for (Long id : due) {
            step("last-mile " + id, () -> tx.executeWithoutResult(s -> lastMileStep(id)));
        }
    }

    private void lastMileStep(long id) {
        Shipment s = shipments.findWithDetails(id).orElse(null);
        Instant now = clock.instant();
        if (s == null || s.getNextStepAt() == null || s.getNextStepAt().isAfter(now)) {
            return;
        }
        String place = s.getDestination().getName();
        switch (s.getStatus()) {
            case ARRIVED_HUB -> {
                s.moveTo(ShipmentStatus.OUT_FOR_DELIVERY, now);
                s.scheduleNextStep(now.plus(Duration.ofMinutes(rnd.nextInt(60, 240))));
                journal.record(s, place, "Courier " + FakeData.driver(rnd.nextInt(30)) + " is out for delivery", now);
            }
            case OUT_FOR_DELIVERY -> {
                if (rnd.nextDouble() < props.exceptionRate()) {
                    String reason = FakeData.pick(DELIVERY_FAILURES, rnd);
                    s.markException(reason, now);
                    journal.record(s, place, "Delivery failed: " + reason, now);
                } else {
                    s.moveTo(ShipmentStatus.DELIVERED, now);
                    journal.record(s, place, "Delivered to " + s.getReceiverName(), now);
                }
            }
            default -> {
            }
        }
    }

    private void alertNewlyLate(Instant from, Instant to) {
        List<Object[]> rows = shipments.findNewlyLate(ShipmentStatus.ACTIVE, from, to);
        if (rows.isEmpty()) {
            return;
        }
        if (rows.size() <= 3) {
            for (Object[] row : rows) {
                live.publish(LiveEvent.warn("alert", "Shipment " + row[0] + " (" + row[1] + " → " + row[2] + ") is past its delivery deadline",
                        Map.of("trackingNo", row[0], "event", "late"), to));
            }
        } else {
            live.publish(LiveEvent.warn("alert", rows.size() + " shipments have passed their delivery deadlines",
                    Map.of("count", rows.size(), "event", "late"), to));
        }
    }


    private void generateOrders(Duration simElapsed) {
        orderBacklog += props.shipmentsPerHour() * simElapsed.toMillis() / 3_600_000.0;
        int count = (int) Math.min(orderBacklog, MAX_NEW_ORDERS_PER_TICK);
        orderBacklog = Math.min(orderBacklog - count, MAX_NEW_ORDERS_PER_TICK);
        if (count == 0) {
            return;
        }
        List<Hub> hubList = hubs.findAllByOrderByIdAsc();
        List<Merchant> active = merchants.findAllWithHub().stream().filter(Merchant::isActive).toList();
        if (hubList.size() < 2 || active.isEmpty()) {
            return;
        }
        for (int i = 0; i < count; i++) {
            Merchant merchant = FakeData.pickMerchant(active, rnd);
            shipmentService.create(FakeData.randomOrder(merchant, hubList, rnd));
        }
    }

    private void maybeAutoDispatch(Instant now) {
        if (lastAutoDispatch != null && now.isBefore(lastAutoDispatch.plus(props.autoDispatchEvery()))) {
            return;
        }
        lastAutoDispatch = now;
        try {
            dispatch.autoDispatch().get(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException | TimeoutException e) {
            log.warn("auto-dispatch failed: {}", e.toString());
        }
    }
}
