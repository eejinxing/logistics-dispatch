package com.example.logistics.shipment;

import com.example.logistics.geo.Direction;
import com.example.logistics.hub.HubRef;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record QuoteView(
        HubRef origin,
        HubRef destination,
        double distanceKm,
        Direction direction,
        String directionLabel,
        boolean air,
        String mode,
        List<String> route,
        double weightKg,
        Priority priority,
        BigDecimal price,
        double transitHours,
        Instant promisedBy) {
}
