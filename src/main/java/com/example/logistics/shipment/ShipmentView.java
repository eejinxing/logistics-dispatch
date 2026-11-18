package com.example.logistics.shipment;

import com.example.logistics.dispatch.Trip;
import com.example.logistics.geo.Direction;
import com.example.logistics.hub.HubRef;
import com.example.logistics.merchant.Merchant;

import java.math.BigDecimal;
import java.time.Instant;

public record ShipmentView(
        Long id,
        String trackingNo,
        Long merchantId,
        String merchantName,
        String senderName,
        String receiverName,
        String receiverPhone,
        String receiverAddress,
        HubRef origin,
        HubRef destination,
        HubRef currentHub,
        double weightKg,
        Priority priority,
        String priorityLabel,
        ShipmentStatus status,
        String statusLabel,
        Direction direction,
        String directionLabel,
        double distanceKm,
        BigDecimal price,
        Instant createdAt,
        Instant statusChangedAt,
        Instant promisedBy,
        Instant deliveredAt,
        boolean late,
        String exceptionReason,
        String tripCode,
        String plateNo) {

    public static ShipmentView from(Shipment s, Instant now) {
        Trip trip = s.getTrip();
        Merchant m = s.getMerchant();
        return new ShipmentView(s.getId(), s.getTrackingNo(), m == null ? null : m.getId(),
                m == null ? null : m.getName(), s.getSenderName(), s.getReceiverName(),
                s.getReceiverPhone(), s.getReceiverAddress(), HubRef.from(s.getOrigin()),
                HubRef.from(s.getDestination()), HubRef.from(s.getCurrentHub()), s.getWeightKg(), s.getPriority(),
                s.getPriority().label(), s.getStatus(), s.getStatus().label(), s.getDirection(),
                s.getDirection().label(), s.getDistanceKm(), s.getPrice(), s.getCreatedAt(), s.getStatusChangedAt(),
                s.getPromisedBy(), s.getDeliveredAt(), s.isLate(now), s.getExceptionReason(),
                trip == null ? null : trip.getCode(),
                trip == null ? null : trip.getVehicle().getPlateNo());
    }
}
