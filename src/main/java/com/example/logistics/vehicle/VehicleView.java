package com.example.logistics.vehicle;

import com.example.logistics.dispatch.Trip;
import com.example.logistics.hub.HubRef;

import java.time.LocalDate;
import java.util.List;

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
        double tripLoadKg,
        List<Driver> assignedDrivers,
        boolean refrigerated,
        boolean heavyDuty,
        LocalDate nextServiceOn,
        Integer fuelScore) {

    public record Driver(String name, Integer portrait) {
    }

    public static VehicleView from(Vehicle v, Trip activeTrip) {
        return new VehicleView(v.getId(), v.getPlateNo(), v.getType(), v.getType().label(), v.getCapacityKg(),
                v.getDriverName(), v.getDriverPhone(), v.getStatus(), v.getStatus().label(), HubRef.from(v.getHub()),
                activeTrip == null ? null : activeTrip.getCode(),
                activeTrip == null ? null : HubRef.from(activeTrip.getDestination()),
                activeTrip == null ? 0 : activeTrip.getLoadKg(),
                v.assignedDrivers().stream().map(driver -> new Driver(driver.getName(), driver.getPortrait())).toList(),
                v.isRefrigerated(), v.isHeavyDuty(), v.getNextServiceOn(), v.getFuelScore());
    }
}
