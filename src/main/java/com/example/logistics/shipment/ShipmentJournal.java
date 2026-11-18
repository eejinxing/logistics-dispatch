package com.example.logistics.shipment;

import com.example.logistics.dispatch.Trip;
import com.example.logistics.live.LiveEvent;
import com.example.logistics.live.LiveEventHub;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;

@Component
public class ShipmentJournal {
    private final TrackingEventRepository events;
    private final LiveEventHub live;

    public ShipmentJournal(TrackingEventRepository events, LiveEventHub live) {
        this.events = events;
        this.live = live;
    }

    public void record(Shipment s, String location, String note, Instant at) {
        recordQuietly(s, location, note, at);
        Map<String, Object> data = Map.of(
                "trackingNo", s.getTrackingNo(),
                "status", s.getStatus().name(),
                "origin", s.getOrigin().getCode(),
                "destination", s.getDestination().getCode());
        String message = s.getTrackingNo() + " · " + s.getStatus().label() + (note == null ? "" : " · " + note);
        LiveEvent event = switch (s.getStatus()) {
            case DELIVERED -> LiveEvent.success("shipment", message, data, at);
            case EXCEPTION, CANCELLED -> LiveEvent.warn("shipment", message, data, at);
            default -> LiveEvent.info("shipment", message, data, at);
        };
        live.publishAfterCommit(event);
    }

    public void recordQuietly(Shipment s, String location, String note, Instant at) {
        events.save(new TrackingEvent(s, s.getStatus(), location, note, at));
    }

    public static String currentLocation(Shipment s) {
        if (s.getStatus() == ShipmentStatus.IN_TRANSIT) {
            Trip trip = s.getTrip();
            return trip == null ? "In transit"
                    : "In transit " + trip.getOrigin().getCode() + " → " + trip.getDestination().getCode();
        }
        return s.getCurrentHub().getName();
    }
}
