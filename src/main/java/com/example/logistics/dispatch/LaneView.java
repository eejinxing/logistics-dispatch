package com.example.logistics.dispatch;

import com.example.logistics.geo.Direction;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRef;
import com.example.logistics.hub.Routes;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.shipment.ShipmentView;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

public record LaneView(
        HubRef origin,
        HubRef destination,
        Direction direction,
        String directionLabel,
        boolean air,
        int count,
        int expressCount,
        int transferCount,
        double totalKg,
        Instant waitingSince,
        boolean overdue,
        List<ShipmentView> shipments) {

    static LaneView of(List<Shipment> lane, Hub nextHop, Instant now, Duration consolidationWait) {
        Hub here = lane.getFirst().getCurrentHub();
        Direction direction = here.directionTo(nextHop);
        Instant oldest = lane.stream().map(Shipment::getStatusChangedAt).min(Instant::compareTo).orElse(now);
        return new LaneView(HubRef.from(here), HubRef.from(nextHop), direction, direction.label(),
                Routes.requiresAir(here, nextHop), lane.size(),
                (int) lane.stream().filter(s -> s.getPriority() == Priority.EXPRESS).count(),
                (int) lane.stream().filter(s -> s.getStatus() == ShipmentStatus.AT_TRANSFER
                        || !s.getDestination().sameAs(nextHop)).count(),
                lane.stream().mapToDouble(Shipment::getWeightKg).sum(), oldest,
                DispatchRules.isOverdue(lane, now, consolidationWait),
                lane.stream().map(s -> ShipmentView.from(s, now)).toList());
    }
}
