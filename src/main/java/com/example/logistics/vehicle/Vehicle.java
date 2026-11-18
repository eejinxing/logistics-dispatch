package com.example.logistics.vehicle;

import com.example.logistics.common.BusinessException;
import com.example.logistics.hub.Hub;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

@Entity
@Table(name = "vehicles")
public class Vehicle {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 16)
    private String plateNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private VehicleType type;

    private int capacityKg;

    @Column(nullable = false, length = 60)
    private String driverName;

    @Column(length = 30)
    private String driverPhone;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private VehicleStatus status = VehicleStatus.IDLE;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "hub_id")
    private Hub hub;

    @Version
    private long version;

    protected Vehicle() {
    }

    public Vehicle(String plateNo, VehicleType type, int capacityKg, String driverName, String driverPhone, Hub hub) {
        this.plateNo = plateNo;
        this.type = type;
        this.capacityKg = capacityKg;
        this.driverName = driverName;
        this.driverPhone = driverPhone;
        this.hub = hub;
    }

    public void startTrip() {
        if (status != VehicleStatus.IDLE) {
            throw new BusinessException("Vehicle " + plateNo + " is currently \"" + status.label() + "\". It cannot depart.");
        }
        status = VehicleStatus.ON_TRIP;
    }

    public void finishTrip(Hub arrivedAt) {
        status = VehicleStatus.IDLE;
        hub = arrivedAt;
    }

    public void setMaintenance(boolean on) {
        if (on) {
            if (status != VehicleStatus.IDLE) {
                throw new BusinessException("Only idle vehicles can enter maintenance. " + plateNo + " is currently \"" + status.label() + "\".");
            }
            status = VehicleStatus.MAINTENANCE;
        } else {
            if (status != VehicleStatus.MAINTENANCE) {
                throw new BusinessException("Vehicle " + plateNo + " is not under maintenance");
            }
            status = VehicleStatus.IDLE;
        }
    }

    public Long getId() {
        return id;
    }

    public String getPlateNo() {
        return plateNo;
    }

    public VehicleType getType() {
        return type;
    }

    public int getCapacityKg() {
        return capacityKg;
    }

    public String getDriverName() {
        return driverName;
    }

    public String getDriverPhone() {
        return driverPhone;
    }

    public VehicleStatus getStatus() {
        return status;
    }

    public Hub getHub() {
        return hub;
    }

    public long getVersion() {
        return version;
    }
}
