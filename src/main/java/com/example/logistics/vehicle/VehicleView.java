package com.example.logistics.vehicle;

import com.example.logistics.dispatch.Trip;
import com.example.logistics.hub.HubRef;

public record VehicleView(
        Long id,
        String plateNo,
        VehicleType type,
        String typeLabel,
        int capacityKg,
        String driverName,
        String driverPhone,
        VehicleStatus status,
        String statusLabel,
        HubRef hub,
        String tripCode,
        HubRef tripDestination,
        double tripLoadKg) {

    public static VehicleView from(Vehicle v, Trip activeTrip) {
        return new VehicleView(v.getId(), v.getPlateNo(), v.getType(), v.getType().label(), v.getCapacityKg(),
                v.getDriverName(), v.getDriverPhone(), v.getStatus(), v.getStatus().label(), HubRef.from(v.getHub()),
                activeTrip == null ? null : activeTrip.getCode(),
                activeTrip == null ? null : HubRef.from(activeTrip.getDestination()),
                activeTrip == null ? 0 : activeTrip.getLoadKg());
    }
}
