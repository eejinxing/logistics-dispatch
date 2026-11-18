package com.example.logistics.dashboard;

import com.example.logistics.geo.Direction;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.shipment.ShipmentView;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record DashboardView(
        Instant generatedAt,
        Long originId,
        String scope,
        List<StatusCount> statuses,
        List<DirectionCount> directions,
        List<LaneVolume> lanes,
        Today today,
        Alerts alerts,
        Fleet fleet,
        List<String> degraded) {

    public record StatusCount(ShipmentStatus status, String label, long count) {
    }

    public record DirectionCount(Direction direction, String label, long count, double weightKg) {
    }

    public record LaneVolume(long originId, long destinationId, Direction direction, String directionLabel,
                             long count, double weightKg) {
    }

    public record Today(long created, BigDecimal revenue, long delivered, long deliveredOnTime,
                        long delivered24h, double onTimeRate24h) {
    }

    public record Alerts(long late, long exceptions, List<ShipmentView> topLate, List<ShipmentView> latestExceptions,
                         List<ExceptionBucket> exceptionTrend) {
    }

    public record ExceptionBucket(Instant start, long count) {
    }

    public record Fleet(long total, long idle, long onTrip, long maintenance, double utilisation) {
    }
}
