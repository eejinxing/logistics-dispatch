package com.example.logistics.dispatch;

import com.example.logistics.common.BusinessException;
import com.example.logistics.hub.Hub;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.vehicle.Vehicle;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "trips", indexes = @Index(name = "ix_trip_status", columnList = "status"))
public class Trip {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 16)
    private String code;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "vehicle_id")
    private Vehicle vehicle;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "origin_id")
    private Hub origin;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "destination_id")
    private Hub destination;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TripStatus status = TripStatus.LOADING;

    private boolean relocation;

    private double loadKg;
    private double distanceKm;

    @Column(nullable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private Instant departAt;
    @Column(nullable = false)
    private Instant arriveAt;
    private Instant arrivedAt;

    @Column(length = 120)
    private String delayReason;

    @OneToMany(mappedBy = "trip")
    private List<Shipment> shipments = new ArrayList<>();

    @Version
    private long version;

    protected Trip() {
    }

    public Trip(String code, Vehicle vehicle, Hub origin, Hub destination, boolean relocation, double loadKg,
                double distanceKm, Instant createdAt, Instant departAt, Instant arriveAt) {
        this.code = code;
        this.vehicle = vehicle;
        this.origin = origin;
        this.destination = destination;
        this.relocation = relocation;
        this.loadKg = loadKg;
        this.distanceKm = distanceKm;
        this.createdAt = createdAt;
        this.departAt = departAt;
        this.arriveAt = arriveAt;
    }

    public void depart() {
        if (status != TripStatus.LOADING) {
            throw new BusinessException("Trip " + code + " is not loading");
        }
        status = TripStatus.IN_TRANSIT;
    }

    public void delay(Duration by, String reason) {
        arriveAt = arriveAt.plus(by);
        delayReason = reason;
    }

    public void arrive(Instant at) {
        if (status != TripStatus.IN_TRANSIT) {
            throw new BusinessException("Trip " + code + " is not in transit");
        }
        status = TripStatus.ARRIVED;
        arrivedAt = at;
    }

    public void unload(double kg) {
        if (status != TripStatus.LOADING) {
            throw new BusinessException("Trip " + code + " has departed and cannot be unloaded");
        }
        loadKg = Math.max(0, loadKg - kg);
    }

    public double progressAt(Instant now) {
        if (status == TripStatus.ARRIVED) {
            return 1;
        }
        if (now.isBefore(departAt)) {
            return 0;
        }
        long total = Duration.between(departAt, arriveAt).toMillis();
        if (total <= 0) {
            return 1;
        }
        return Math.min(1, Duration.between(departAt, now).toMillis() / (double) total);
    }

    public Long getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public Vehicle getVehicle() {
        return vehicle;
    }

    public Hub getOrigin() {
        return origin;
    }

    public Hub getDestination() {
        return destination;
    }

    public TripStatus getStatus() {
        return status;
    }

    public boolean isRelocation() {
        return relocation;
    }

    public double getLoadKg() {
        return loadKg;
    }

    public double getDistanceKm() {
        return distanceKm;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getDepartAt() {
        return departAt;
    }

    public Instant getArriveAt() {
        return arriveAt;
    }

    public Instant getArrivedAt() {
        return arrivedAt;
    }

    public String getDelayReason() {
        return delayReason;
    }

    public List<Shipment> getShipments() {
        return shipments;
    }
}
