package com.example.logistics.tracking;

import com.example.logistics.dispatch.TripStatus;
import com.example.logistics.geo.Direction;
import com.example.logistics.hub.HubRef;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.vehicle.VehicleType;

import java.time.Instant;
import java.util.List;

public record TrackingView(
        String trackingNo,
        ShipmentStatus status,
        String statusLabel,
        boolean full,
        String merchantName,
        String receiverName,
        String receiverAddress,
        HubRef origin,
        HubRef destination,
        HubRef currentHub,
        List<HubRef> route,
        Direction direction,
        String directionLabel,
        Priority priority,
        String priorityLabel,
        double weightKg,
        Instant createdAt,
        Instant promisedBy,
        Instant deliveredAt,
        boolean late,
        String exceptionReason,
        Leg leg,
        List<Event> events,
        Instant now,
        double timeScale,
        boolean paused) {

    public record Leg(String tripCode, HubRef from, HubRef to, TripStatus status, String statusLabel,
                      VehicleType vehicleType, String vehicleTypeLabel, Instant departAt, Instant arriveAt,
                      String delayReason) {
    }

    public record Event(ShipmentStatus status, String statusLabel, String location, String note, Instant occurredAt) {
    }
}
