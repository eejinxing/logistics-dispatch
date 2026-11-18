package com.example.logistics.tracking;

import com.example.logistics.geo.Direction;
import com.example.logistics.hub.HubRef;
import com.example.logistics.merchant.Merchant;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentStatus;

import java.time.Instant;

public record ParcelView(
        String trackingNo,
        ShipmentStatus status,
        String statusLabel,
        String senderName,
        HubRef origin,
        HubRef destination,
        HubRef currentHub,
        Direction direction,
        String directionLabel,
        Instant createdAt,
        Instant promisedBy,
        Instant deliveredAt,
        boolean late) {

    static ParcelView from(Shipment s, Instant now) {
        Merchant m = s.getMerchant();
        return new ParcelView(s.getTrackingNo(), s.getStatus(), s.getStatus().label(),
                m == null ? s.getSenderName() : m.getName(), HubRef.from(s.getOrigin()),
                HubRef.from(s.getDestination()), HubRef.from(s.getCurrentHub()), s.getDirection(),
                s.getDirection().label(), s.getCreatedAt(), s.getPromisedBy(), s.getDeliveredAt(), s.isLate(now));
    }
}
