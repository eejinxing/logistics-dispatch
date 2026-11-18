package com.example.logistics.vehicle;

import com.example.logistics.common.BusinessException;
import com.example.logistics.common.NotFoundException;
import com.example.logistics.concurrent.KeyedLocks;
import com.example.logistics.dispatch.Trip;
import com.example.logistics.dispatch.TripRepository;
import com.example.logistics.dispatch.TripStatus;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.live.LiveEvent;
import com.example.logistics.live.LiveEventHub;
import com.example.logistics.simulation.SimulationClock;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class VehicleService {
    private final VehicleRepository vehicles;
    private final TripRepository trips;
    private final HubRepository hubs;
    private final KeyedLocks<Long> hubLocks;
    private final TransactionTemplate tx;
    private final LiveEventHub live;
    private final SimulationClock clock;

    public VehicleService(VehicleRepository vehicles, TripRepository trips, HubRepository hubs,
                          KeyedLocks<Long> hubLocks, TransactionTemplate tx, LiveEventHub live, SimulationClock clock) {
        this.vehicles = vehicles;
        this.trips = trips;
        this.hubs = hubs;
        this.hubLocks = hubLocks;
        this.tx = tx;
        this.live = live;
        this.clock = clock;
    }

    public record CreateVehicleRequest(
            @NotBlank(message = "Enter a plate number") @Size(max = 16) String plateNo,
            @NotNull(message = "Select a vehicle type") VehicleType type,
            @Min(value = 100, message = "Capacity must be at least 100 kg") Integer capacityKg,
            @NotBlank(message = "Enter a driver name") @Size(max = 60) String driverName,
            @Size(max = 30) String driverPhone,
            @NotNull(message = "Select the current hub") Long hubId) {
    }

    @Transactional(readOnly = true)
    public List<VehicleView> list() {
        Map<Long, Trip> activeByVehicle = trips
                .findWithDetailsByStatusIn(EnumSet.of(TripStatus.LOADING, TripStatus.IN_TRANSIT)).stream()
                .collect(Collectors.toMap(t -> t.getVehicle().getId(), Function.identity(), (a, b) -> a));
        return vehicles.findAllWithHub().stream()
                .map(v -> VehicleView.from(v, activeByVehicle.get(v.getId())))
                .toList();
    }

    @Transactional
    public VehicleView create(CreateVehicleRequest request) {
        String plate = request.plateNo().trim().toUpperCase(Locale.ROOT);
        if (vehicles.existsByPlateNoIgnoreCase(plate)) {
            throw new BusinessException("Plate number " + plate + " already exists");
        }
        Hub hub = hubs.findById(request.hubId())
                .orElseThrow(() -> new NotFoundException("Hub not found: " + request.hubId()));
        int capacity = request.capacityKg() == null ? request.type().defaultCapacityKg() : request.capacityKg();
        Vehicle vehicle = vehicles.save(new Vehicle(plate, request.type(), capacity, request.driverName().trim(),
                request.driverPhone(), hub));
        live.publishAfterCommit(LiveEvent.info("fleet", "Vehicle added: " + plate + " (" + request.type().label() + ") @ "
                + hub.getCode(), Map.of("plateNo", plate), clock.instant()));
        return VehicleView.from(vehicle, null);
    }

    public VehicleView setMaintenance(long id, boolean on) {
        Long hubId = tx.execute(status -> vehicles.findById(id).map(v -> v.getHub().getId())
                .orElseThrow(() -> new NotFoundException("Vehicle not found: " + id)));
        if (hubId == null) {
            throw new NotFoundException("Vehicle not found: " + id);
        }
        return hubLocks.withLock(hubId, () -> tx.execute(status -> {
            Vehicle v = vehicles.findById(id).orElseThrow(() -> new NotFoundException("Vehicle not found: " + id));
            v.setMaintenance(on);
            String message = v.getPlateNo() + (on ? " entered maintenance" : " completed maintenance and is available") + " @ " + v.getHub().getCode();
            live.publishAfterCommit(on
                    ? LiveEvent.warn("fleet", message, Map.of("plateNo", v.getPlateNo()), clock.instant())
                    : LiveEvent.success("fleet", message, Map.of("plateNo", v.getPlateNo()), clock.instant()));
            return VehicleView.from(v, null);
        }));
    }
}
