package com.example.logistics.tracking;

import com.example.logistics.common.NotFoundException;
import com.example.logistics.dispatch.Trip;
import com.example.logistics.dispatch.TripStatus;
import com.example.logistics.hub.HubRef;
import com.example.logistics.hub.RoutePlanner;
import com.example.logistics.merchant.Merchant;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.shipment.TrackingEventRepository;
import com.example.logistics.simulation.SimulationClock;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
public class TrackingService {
    private static final int MAX_PARCELS = 100;
    private static final Set<ShipmentStatus> ON_A_VEHICLE = EnumSet.of(ShipmentStatus.ASSIGNED, ShipmentStatus.IN_TRANSIT);

    private final ShipmentRepository shipments;
    private final TrackingEventRepository events;
    private final RoutePlanner routes;
    private final SimulationClock clock;

    public TrackingService(ShipmentRepository shipments, TrackingEventRepository events, RoutePlanner routes,
                           SimulationClock clock) {
        this.shipments = shipments;
        this.events = events;
        this.routes = routes;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<ParcelView> parcelsFor(String phoneKey) {
        Instant now = clock.instant();
        return shipments.findForReceiver(phoneKey, PageRequest.of(0, MAX_PARCELS)).stream()
                .map(s -> ParcelView.from(s, now))
                .toList();
    }

    @Transactional(readOnly = true)
    public TrackingView forCustomer(String phoneKey, String trackingNo) {
        Shipment s = find(trackingNo);
        if (phoneKey == null || !phoneKey.equals(s.getReceiverPhoneKey())) {
            throw new NotFoundException("Shipment not found: " + trackingNo);
        }
        return build(s, true);
    }

    @Transactional(readOnly = true)
    public TrackingView forPublic(String trackingNo) {
        return build(find(trackingNo), false);
    }

    private Shipment find(String trackingNo) {
        return shipments.findByTrackingNo(trackingNo.trim().toUpperCase(Locale.ROOT))
                .orElseThrow(() -> new NotFoundException("Shipment not found: " + trackingNo));
    }

    private TrackingView build(Shipment s, boolean full) {
        Instant now = clock.instant();
        Trip trip = s.getTrip();
        TrackingView.Leg leg = null;
        if (trip != null && trip.getStatus() != TripStatus.ARRIVED && ON_A_VEHICLE.contains(s.getStatus())) {
            leg = new TrackingView.Leg(trip.getCode(), HubRef.from(trip.getOrigin()), HubRef.from(trip.getDestination()),
                    trip.getStatus(), trip.getStatus().label(), trip.getVehicle().getType(),
                    trip.getVehicle().getType().label(), trip.getDepartAt(), trip.getArriveAt(), trip.getDelayReason());
        }
        List<TrackingView.Event> history = events.findTimeline(s.getId()).stream()
                .map(e -> new TrackingView.Event(e.getStatus(), e.getStatus().label(), e.getLocation(),
                        full ? e.getNote() : null, e.getOccurredAt()))
                .toList();
        Merchant m = s.getMerchant();
        return new TrackingView(s.getTrackingNo(), s.getStatus(), s.getStatus().label(), full,
                full ? (m == null ? s.getSenderName() : m.getName()) : null,
                full ? s.getReceiverName() : null,
                full ? s.getReceiverAddress() : null,
                HubRef.from(s.getOrigin()), HubRef.from(s.getDestination()), HubRef.from(s.getCurrentHub()),
                routes.path(s.getOrigin(), s.getDestination()).stream().map(HubRef::from).toList(),
                s.getDirection(), s.getDirection().label(), s.getPriority(), s.getPriority().label(), s.getWeightKg(),
                s.getCreatedAt(), s.getPromisedBy(), s.getDeliveredAt(), s.isLate(now),
                full ? s.getExceptionReason() : null, leg, history, now, clock.scale(), clock.isPaused());
    }
}
