package com.example.logistics.merchant;

import com.example.logistics.dashboard.DashboardView.DirectionCount;
import com.example.logistics.dashboard.DashboardView.LaneVolume;
import com.example.logistics.dashboard.DashboardView.StatusCount;
import com.example.logistics.shipment.ShipmentView;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record MerchantDashboard(
        Instant generatedAt,
        MerchantView merchant,
        List<StatusCount> statuses,
        List<DirectionCount> directions,
        List<LaneVolume> lanes,
        long createdToday,
        BigDecimal spendToday,
        long created30d,
        BigDecimal spend30d,
        long delivered30d,
        double onTimeRate30d,
        long late,
        List<ShipmentView> recent) {
}
