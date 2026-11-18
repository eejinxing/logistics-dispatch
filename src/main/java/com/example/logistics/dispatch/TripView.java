package com.example.logistics.dispatch;

import com.example.logistics.geo.Direction;
import com.example.logistics.hub.HubRef;
import com.example.logistics.vehicle.Vehicle;
import com.example.logistics.vehicle.VehicleType;

import java.time.Instant;

public record TripView(
        Long id,
        String code,
        Long vehicleId,
        String plateNo,
        VehicleType vehicleType,
        String vehicleTypeLabel,
        String driverName,
        int capacityKg,
        HubRef origin,
        HubRef destination,
        Direction direction,
        String directionLabel,
        TripStatus status,
        String statusLabel,
        boolean relocation,
        double loadKg,
        int shipmentCount,
        double distanceKm,
        Instant createdAt,
        Instant departAt,
        Instant arriveAt,
        Instant arrivedAt,
        String delayReason) {

    public static TripView from(Trip trip, int shipmentCount) {
        Vehicle v = trip.getVehicle();
        Direction direction = trip.getOrigin().directionTo(trip.getDestination());
        return new TripView(trip.getId(), trip.getCode(), v.getId(), v.getPlateNo(), v.getType(), v.getType().label(),
                v.getDriverName(), v.getCapacityKg(), HubRef.from(trip.getOrigin()), HubRef.from(trip.getDestination()),
                direction, direction.label(), trip.getStatus(), trip.getStatus().label(), trip.isRelocation(),
                trip.getLoadKg(), shipmentCount, trip.getDistanceKm(), trip.getCreatedAt(), trip.getDepartAt(),
                trip.getArriveAt(), trip.getArrivedAt(), trip.getDelayReason());
    }
}
