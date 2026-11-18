package com.example.logistics.dispatch;

import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.vehicle.Vehicle;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

public final class DispatchRules {
    private DispatchRules() {
    }

    public static boolean isOverdue(List<Shipment> lane, Instant now, Duration consolidationWait) {
        return lane.stream().anyMatch(s -> {
            Duration wait = s.getPriority() == Priority.EXPRESS ? consolidationWait.dividedBy(2) : consolidationWait;
            return !s.getStatusChangedAt().plus(wait).isAfter(now);
        });
    }

    public static double fill(Vehicle v, double laneKg) {
        return Math.min(laneKg, v.getCapacityKg()) / v.getCapacityKg();
    }

    public static Vehicle chooseVehicle(List<Vehicle> candidates, double laneKg, boolean overdue, double fillThreshold) {
        if (candidates.isEmpty()) {
            return null;
        }
        Optional<Vehicle> smallestFitting = candidates.stream()
                .filter(v -> v.getCapacityKg() >= laneKg)
                .min(Comparator.comparingInt(Vehicle::getCapacityKg));
        if (overdue) {
            return smallestFitting.orElseGet(() ->
                    candidates.stream().max(Comparator.comparingInt(Vehicle::getCapacityKg)).orElseThrow());
        }
        if (smallestFitting.isPresent() && fill(smallestFitting.get(), laneKg) >= fillThreshold) {
            return smallestFitting.get();
        }
        Vehicle best = candidates.stream()
                .max(Comparator.comparingDouble((Vehicle v) -> fill(v, laneKg))
                        .thenComparingInt(Vehicle::getCapacityKg))
                .orElseThrow();
        return fill(best, laneKg) >= fillThreshold ? best : null;
    }
}
