package com.example.logistics.shipment;

import com.example.logistics.common.BusinessException;
import com.example.logistics.dispatch.Trip;
import com.example.logistics.geo.Direction;
import com.example.logistics.hub.Hub;
import com.example.logistics.merchant.Merchant;
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
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "shipments", indexes = {
        @Index(name = "ix_shipment_status", columnList = "status"),
        @Index(name = "ix_shipment_origin_status", columnList = "origin_id,status"),
        @Index(name = "ix_shipment_created", columnList = "created_at"),
        @Index(name = "ix_shipment_next_step", columnList = "next_step_at"),
        @Index(name = "ix_shipment_merchant", columnList = "merchant_id")
})
public class Shipment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 20)
    private String trackingNo;

    @Column(nullable = false, length = 80)
    private String senderName;

    @Column(nullable = false, length = 80)
    private String receiverName;

    @Column(length = 30)
    private String receiverPhone;

    @Column(length = 200)
    private String receiverAddress;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "merchant_id")
    private Merchant merchant;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "origin_id")
    private Hub origin;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "destination_id")
    private Hub destination;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "current_hub_id")
    private Hub currentHub;

    private double weightKg;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private Priority priority;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ShipmentStatus status = ShipmentStatus.CREATED;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 4)
    private Direction direction;

    private double distanceKm;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal price;

    @Column(nullable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private Instant statusChangedAt;
    @Column(nullable = false)
    private Instant promisedBy;
    private Instant deliveredAt;
    private Instant nextStepAt;

    @Column(length = 120)
    private String exceptionReason;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "trip_id")
    private Trip trip;

    @Version
    private long version;

    protected Shipment() {
    }

    public Shipment(String trackingNo, String senderName, String receiverName, String receiverPhone,
                    String receiverAddress, Hub origin, Hub destination, double weightKg, Priority priority,
                    Direction direction, double distanceKm, BigDecimal price, Instant createdAt, Instant promisedBy,
                    Merchant merchant) {
        this.trackingNo = trackingNo;
        this.senderName = senderName;
        this.receiverName = receiverName;
        this.receiverPhone = receiverPhone;
        this.receiverAddress = receiverAddress;
        this.merchant = merchant;
        this.origin = origin;
        this.destination = destination;
        this.currentHub = origin;
        this.weightKg = weightKg;
        this.priority = priority;
        this.direction = direction;
        this.distanceKm = distanceKm;
        this.price = price;
        this.createdAt = createdAt;
        this.statusChangedAt = createdAt;
        this.promisedBy = promisedBy;
    }

    public void moveTo(ShipmentStatus next, Instant at) {
        if (!status.canMoveTo(next)) {
            throw new BusinessException("Shipment " + trackingNo + " is currently \"" + status.label() + "\". It cannot move to \""
                    + next.label() + "\"");
        }
        status = next;
        statusChangedAt = at;
        nextStepAt = null;
        if (next != ShipmentStatus.EXCEPTION) {
            exceptionReason = null;
        }
        if (next == ShipmentStatus.DELIVERED) {
            deliveredAt = at;
        }
    }

    public void assignTo(Trip trip, Instant at) {
        moveTo(ShipmentStatus.ASSIGNED, at);
        this.trip = trip;
    }

    public void arriveAt(Hub hub, Instant at) {
        boolean last = destination.sameAs(hub);
        moveTo(last ? ShipmentStatus.ARRIVED_HUB : ShipmentStatus.AT_TRANSFER, at);
        currentHub = hub;
    }

    public void resumeAt(Hub hub, Instant at) {
        moveTo(destination.sameAs(hub) ? ShipmentStatus.OUT_FOR_DELIVERY : ShipmentStatus.AT_TRANSFER, at);
        currentHub = hub;
    }

    public void cancel(Instant at) {
        if (currentHub != null && origin != null && !currentHub.sameAs(origin)) {
            throw new BusinessException("Shipment " + trackingNo + " has left its origin hub. Flag an exception if there is a problem.");
        }
        moveTo(ShipmentStatus.CANCELLED, at);
        trip = null;
    }

    public void markException(String reason, Instant at) {
        moveTo(ShipmentStatus.EXCEPTION, at);
        exceptionReason = reason;
    }

    public void scheduleNextStep(Instant at) {
        nextStepAt = at;
    }

    public boolean isLate(Instant now) {
        if (status == ShipmentStatus.CANCELLED) {
            return false;
        }
        Instant reference = status == ShipmentStatus.DELIVERED ? deliveredAt : now;
        return reference != null && reference.isAfter(promisedBy);
    }

    public Long getId() {
        return id;
    }

    public String getTrackingNo() {
        return trackingNo;
    }

    public String getSenderName() {
        return senderName;
    }

    public String getReceiverName() {
        return receiverName;
    }

    public String getReceiverPhone() {
        return receiverPhone;
    }

    public String getReceiverAddress() {
        return receiverAddress;
    }

    public Merchant getMerchant() {
        return merchant;
    }

    public Hub getOrigin() {
        return origin;
    }

    public Hub getDestination() {
        return destination;
    }

    public Hub getCurrentHub() {
        return currentHub;
    }

    public double getWeightKg() {
        return weightKg;
    }

    public Priority getPriority() {
        return priority;
    }

    public ShipmentStatus getStatus() {
        return status;
    }

    public Direction getDirection() {
        return direction;
    }

    public double getDistanceKm() {
        return distanceKm;
    }

    public BigDecimal getPrice() {
        return price;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getStatusChangedAt() {
        return statusChangedAt;
    }

    public Instant getPromisedBy() {
        return promisedBy;
    }

    public Instant getDeliveredAt() {
        return deliveredAt;
    }

    public Instant getNextStepAt() {
        return nextStepAt;
    }

    public String getExceptionReason() {
        return exceptionReason;
    }

    public Trip getTrip() {
        return trip;
    }
}
