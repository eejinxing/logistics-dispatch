package com.example.logistics.dashboard;

import com.example.logistics.concurrent.BulkheadRegistry;
import com.example.logistics.concurrent.SingleFlight;
import com.example.logistics.concurrent.Throwables;
import com.example.logistics.config.ConcurrencyProperties;
import com.example.logistics.dashboard.DashboardView.Alerts;
import com.example.logistics.dashboard.DashboardView.DirectionCount;
import com.example.logistics.dashboard.DashboardView.Fleet;
import com.example.logistics.dashboard.DashboardView.LaneVolume;
import com.example.logistics.dashboard.DashboardView.StatusCount;
import com.example.logistics.dashboard.DashboardView.Today;
import com.example.logistics.geo.Direction;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.shipment.ShipmentView;
import com.example.logistics.simulation.SimulationClock;
import com.example.logistics.vehicle.VehicleRepository;
import com.example.logistics.vehicle.VehicleStatus;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static com.example.logistics.config.ExecutorConfig.IO_EXECUTOR;

@Service
public class DashboardService {
    private static final Logger log = LoggerFactory.getLogger(DashboardService.class);
    private static final String BULKHEAD = "dashboard";
    private static final int LANE_LIMIT = 40;

    private final ShipmentRepository shipments;
    private final VehicleRepository vehicles;
    private final SimulationClock clock;
    private final BulkheadRegistry bulkheads;
    private final Executor ioExecutor;
    private final MeterRegistry metrics;
    private final long partTimeoutMs;
    private final SingleFlight<String, DashboardView> flights = new SingleFlight<>();

    public DashboardService(ShipmentRepository shipments, VehicleRepository vehicles, SimulationClock clock,
                            BulkheadRegistry bulkheads, @Qualifier(IO_EXECUTOR) Executor ioExecutor,
                            ConcurrencyProperties props, MeterRegistry metrics) {
        this.shipments = shipments;
        this.vehicles = vehicles;
        this.clock = clock;
        this.bulkheads = bulkheads;
        this.ioExecutor = ioExecutor;
        this.metrics = metrics;
        this.partTimeoutMs = props.dashboardTimeout().toMillis();
    }

    public CompletableFuture<DashboardView> summary(Long originId, String scope) {
        String normalisedScope = "all".equalsIgnoreCase(scope) ? "all" : "active";
        return flights.run(originId + "|" + normalisedScope, () -> load(originId, normalisedScope));
    }

    private CompletableFuture<DashboardView> load(Long originId, String scope) {
        Instant now = clock.instant();
        Instant dayStart = now.atZone(clock.getZone()).toLocalDate().atStartOfDay(clock.getZone()).toInstant();
        Set<ShipmentStatus> flowStatuses = "all".equals(scope)
                ? EnumSet.complementOf(EnumSet.of(ShipmentStatus.CANCELLED))
                : ShipmentStatus.ACTIVE;

        CompletableFuture<Optional<List<StatusCount>>> statuses = part("statuses", this::statusCounts);
        CompletableFuture<Optional<List<DirectionCount>>> directions =
                part("directions", () -> directionCounts(flowStatuses, originId));
        CompletableFuture<Optional<List<LaneVolume>>> lanes = part("lanes", () -> laneVolumes(flowStatuses, originId));
        CompletableFuture<Optional<Today>> today = part("today", () -> today(dayStart, now));
        CompletableFuture<Optional<Alerts>> alerts = part("alerts", () -> alerts(now));
        CompletableFuture<Optional<Fleet>> fleet = part("fleet", this::fleet);

        return CompletableFuture.allOf(statuses, directions, lanes, today, alerts, fleet)
                .thenApply(ignored -> {
                    List<String> degraded = new ArrayList<>();
                    return new DashboardView(now, originId, scope,
                            value(statuses, "statuses", degraded),
                            value(directions, "directions", degraded),
                            value(lanes, "lanes", degraded),
                            value(today, "today", degraded),
                            value(alerts, "alerts", degraded),
                            value(fleet, "fleet", degraded),
                            List.copyOf(degraded));
                });
    }

    private <T> CompletableFuture<Optional<T>> part(String name, Supplier<T> query) {
        return bulkheads.get(BULKHEAD).submit(ioExecutor, query)
                .orTimeout(partTimeoutMs, TimeUnit.MILLISECONDS)
                .handle((value, error) -> {
                    if (error == null) {
                        return Optional.ofNullable(value);
                    }
                    log.warn("dashboard part '{}' unavailable: {}", name, Throwables.unwrap(error).toString());
                    metrics.counter("dashboard.degraded", "part", name).increment();
                    return Optional.empty();
                });
    }

    private static <T> T value(CompletableFuture<Optional<T>> future, String name, List<String> degraded) {
        Optional<T> result = future.join();
        if (result.isEmpty()) {
            degraded.add(name);
        }
        return result.orElse(null);
    }


    private List<StatusCount> statusCounts() {
        Map<ShipmentStatus, Long> counts = new EnumMap<>(ShipmentStatus.class);
        for (Object[] row : shipments.countByStatus()) {
            counts.put((ShipmentStatus) row[0], (Long) row[1]);
        }
        return Arrays.stream(ShipmentStatus.values())
                .map(s -> new StatusCount(s, s.label(), counts.getOrDefault(s, 0L)))
                .toList();
    }

    private List<DirectionCount> directionCounts(Set<ShipmentStatus> statuses, Long originId) {
        Map<Direction, Object[]> rows = new EnumMap<>(Direction.class);
        for (Object[] row : shipments.countByDirection(statuses, originId, null)) {
            rows.put((Direction) row[0], row);
        }
        return Arrays.stream(Direction.values()).map(d -> {
            Object[] row = rows.get(d);
            return row == null
                    ? new DirectionCount(d, d.label(), 0, 0)
                    : new DirectionCount(d, d.label(), (Long) row[1], ((Number) row[2]).doubleValue());
        }).toList();
    }

    private List<LaneVolume> laneVolumes(Set<ShipmentStatus> statuses, Long originId) {
        return shipments.laneVolumes(statuses, originId, null, PageRequest.of(0, LANE_LIMIT)).stream()
                .map(row -> {
                    Direction d = (Direction) row[2];
                    return new LaneVolume((Long) row[0], (Long) row[1], d, d.label(), (Long) row[3],
                            ((Number) row[4]).doubleValue());
                })
                .toList();
    }

    private Today today(Instant dayStart, Instant now) {
        Object[] created = shipments.createdSince(dayStart, ShipmentStatus.CANCELLED, null).getFirst();
        Object[] deliveredToday = shipments.deliveredSince(dayStart, ShipmentStatus.DELIVERED, null).getFirst();
        Object[] delivered24h = shipments.deliveredSince(now.minus(Duration.ofHours(24)), ShipmentStatus.DELIVERED, null).getFirst();
        long d24 = ((Number) delivered24h[0]).longValue();
        long onTime24 = ((Number) delivered24h[1]).longValue();
        return new Today(
                ((Number) created[0]).longValue(),
                toBigDecimal(created[1]),
                ((Number) deliveredToday[0]).longValue(),
                ((Number) deliveredToday[1]).longValue(),
                d24,
                d24 == 0 ? 1.0 : onTime24 / (double) d24);
    }

    private Alerts alerts(Instant now) {
        List<ShipmentView> topLate = shipments.findLate(ShipmentStatus.ACTIVE, now, PageRequest.of(0, 8)).stream()
                .map(s -> ShipmentView.from(s, now)).toList();
        List<ShipmentView> exceptions = shipments.findLatestWithStatus(ShipmentStatus.EXCEPTION, PageRequest.of(0, 8))
                .stream().map(s -> ShipmentView.from(s, now)).toList();
        long exceptionCount = shipments.countByStatus().stream()
                .filter(r -> r[0] == ShipmentStatus.EXCEPTION).mapToLong(r -> (Long) r[1]).sum();
        return new Alerts(shipments.countLate(ShipmentStatus.ACTIVE, now, null), exceptionCount, topLate, exceptions);
    }

    private Fleet fleet() {
        Map<VehicleStatus, Long> counts = new EnumMap<>(VehicleStatus.class);
        for (Object[] row : vehicles.countByStatus()) {
            counts.put((VehicleStatus) row[0], (Long) row[1]);
        }
        long idle = counts.getOrDefault(VehicleStatus.IDLE, 0L);
        long onTrip = counts.getOrDefault(VehicleStatus.ON_TRIP, 0L);
        long maintenance = counts.getOrDefault(VehicleStatus.MAINTENANCE, 0L);
        long total = idle + onTrip + maintenance;
        long available = idle + onTrip;
        return new Fleet(total, idle, onTrip, maintenance, available == 0 ? 0 : onTrip / (double) available);
    }

    private static BigDecimal toBigDecimal(Object value) {
        if (value instanceof BigDecimal bd) {
            return bd;
        }
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }
}
