package com.example.logistics.shipment;

import com.example.logistics.common.BusinessException;
import com.example.logistics.common.CodeGenerator;
import com.example.logistics.common.NotFoundException;
import com.example.logistics.common.PageView;
import com.example.logistics.concurrent.KeyedLocks;
import com.example.logistics.dispatch.Trip;
import com.example.logistics.dispatch.TripStatus;
import com.example.logistics.dispatch.TripView;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.merchant.Merchant;
import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.simulation.SimulationClock;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;

@Service
public class ShipmentService {
    private static final Duration REDELIVERY_AFTER = Duration.ofHours(2);

    private final HubRepository hubs;
    private final ShipmentRepository shipments;
    private final TrackingEventRepository events;
    private final PricingService pricing;
    private final ShipmentJournal journal;
    private final CodeGenerator codes;
    private final SimulationClock clock;
    private final KeyedLocks<Long> hubLocks;
    private final TransactionTemplate tx;
    private final MerchantRepository merchants;

    public ShipmentService(HubRepository hubs, ShipmentRepository shipments, TrackingEventRepository events,
                           PricingService pricing, ShipmentJournal journal, CodeGenerator codes,
                           SimulationClock clock, KeyedLocks<Long> hubLocks, TransactionTemplate tx,
                           MerchantRepository merchants) {
        this.merchants = merchants;
        this.hubs = hubs;
        this.shipments = shipments;
        this.events = events;
        this.pricing = pricing;
        this.journal = journal;
        this.codes = codes;
        this.clock = clock;
        this.hubLocks = hubLocks;
        this.tx = tx;
    }

    @Transactional(readOnly = true)
    public QuoteView quote(QuoteRequest request) {
        Hub origin = hub(request.originId());
        Hub destination = hub(request.destinationId());
        ensureDifferent(origin, destination);
        return pricing.quote(origin, destination, request.weightKg(), request.priorityOrDefault(), clock.instant());
    }

    @Transactional
    public ShipmentView create(CreateShipmentRequest request) {
        Merchant merchant = request.merchantId() == null ? null : activeMerchant(request.merchantId());
        String sender = isBlank(request.senderName()) && merchant != null ? merchant.getName() : request.senderName();
        if (isBlank(sender)) {
            throw new BusinessException("Enter a sender or select a merchant");
        }
        return book(hub(request.originId()), hub(request.destinationId()), sender.trim(), merchant,
                request.receiverName(), request.receiverPhone(), request.receiverAddress(), request.weightKg(),
                request.priorityOrDefault());
    }

    private ShipmentView book(Hub origin, Hub destination, String sender, Merchant merchant, String receiverName,
                              String receiverPhone, String receiverAddress, double weightKg, Priority priority) {
        ensureDifferent(origin, destination);
        Instant now = clock.instant();
        QuoteView quote = pricing.quote(origin, destination, weightKg, priority, now);
        Shipment shipment = shipments.save(new Shipment(
                codes.nextTrackingNo(now, clock.getZone()), sender, receiverName.trim(),
                blankToNull(receiverPhone), blankToNull(receiverAddress), origin, destination, weightKg, priority,
                quote.direction(), quote.distanceKm(), quote.price(), now, quote.promisedBy(), merchant));
        journal.record(shipment, origin.getName(),
                "Collected and awaiting dispatch (" + quote.mode() + " · " + quote.directionLabel() + " · Route "
                        + String.join(" → ", quote.route()) + ")",
                now);
        return ShipmentView.from(shipment, now);
    }

    @Transactional(readOnly = true)
    public PageView<ShipmentView> search(ShipmentFilter filter, int page, int size) {
        Instant now = clock.instant();
        PageRequest pageable = PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, 200),
                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")));
        return PageView.of(shipments.findAll(filter.toSpecification(now, clock.getZone()), pageable),
                s -> ShipmentView.from(s, now));
    }

    @Transactional(readOnly = true)
    public ShipmentDetail detail(String trackingNo) {
        return detailOf(byTrackingNo(trackingNo));
    }

    private ShipmentDetail detailOf(Shipment s) {
        Instant now = clock.instant();
        Trip trip = s.getTrip();
        TripView tripView = trip == null ? null : TripView.from(trip, trip.getShipments().size());
        return new ShipmentDetail(ShipmentView.from(s, now), tripView,
                events.findTimeline(s.getId()).stream().map(ShipmentDetail.Event::from).toList());
    }

    private Shipment byTrackingNo(String trackingNo) {
        return shipments.findByTrackingNo(trackingNo.trim().toUpperCase())
                .orElseThrow(() -> new NotFoundException("Shipment not found: " + trackingNo));
    }

    private Merchant activeMerchant(long id) {
        Merchant merchant = merchants.findWithHub(id).orElseThrow(() -> new NotFoundException("Merchant not found: " + id));
        if (!merchant.isActive()) {
            throw new BusinessException("Merchant " + merchant.getName() + " is disabled");
        }
        return merchant;
    }

    public ShipmentView cancel(long id, String reason) {
        long hubId = currentHubIdOf(id);
        return hubLocks.withLock(hubId, () -> tx.execute(status -> {
            Shipment s = load(id);
            Instant now = clock.instant();
            if (s.getStatus() == ShipmentStatus.ASSIGNED) {
                s.getTrip().unload(s.getWeightKg());
            }
            s.cancel(now);
            journal.record(s, ShipmentJournal.currentLocation(s), "Cancelled" + (isBlank(reason) ? "" : ": " + reason.trim()), now);
            return ShipmentView.from(s, now);
        }));
    }

    @Transactional
    public ShipmentView markException(long id, String reason) {
        if (isBlank(reason)) {
            throw new BusinessException("Enter the reason for the exception");
        }
        Shipment s = load(id);
        Instant now = clock.instant();
        String location = ShipmentJournal.currentLocation(s);
        s.markException(reason.trim(), now);
        journal.record(s, location, "Exception: " + reason.trim(), now);
        return ShipmentView.from(s, now);
    }

    @Transactional
    public ShipmentView resolve(long id, String note) {
        Shipment s = load(id);
        if (s.getStatus() != ShipmentStatus.EXCEPTION) {
            throw new BusinessException("Shipment " + s.getTrackingNo() + " has no active exception");
        }
        Instant now = clock.instant();
        Trip trip = s.getTrip();
        boolean stillOnTheRoad = trip != null && trip.getStatus() != TripStatus.ARRIVED
                && s.getCurrentHub().sameAs(trip.getOrigin());
        String outcome;
        if (stillOnTheRoad) {
            s.moveTo(ShipmentStatus.IN_TRANSIT, now);
            outcome = ", continuing in transit";
        } else {
            Hub at = trip != null && trip.getStatus() == TripStatus.ARRIVED ? trip.getDestination() : s.getCurrentHub();
            s.resumeAt(at, now);
            if (s.getStatus() == ShipmentStatus.OUT_FOR_DELIVERY) {
                s.scheduleNextStep(now.plus(REDELIVERY_AFTER));
                outcome = ", retrying delivery";
            } else {
                outcome = ", waiting at " + at.getCode() + " for transfer";
            }
        }
        journal.record(s, ShipmentJournal.currentLocation(s),
                "Exception resolved" + (isBlank(note) ? "" : ": " + note.trim()) + outcome, now);
        return ShipmentView.from(s, now);
    }

    @Transactional
    public ShipmentView confirmDelivery(long id) {
        Shipment s = load(id);
        Instant now = clock.instant();
        s.moveTo(ShipmentStatus.DELIVERED, now);
        journal.record(s, s.getDestination().getName(), "Delivery confirmed by an administrator", now);
        return ShipmentView.from(s, now);
    }

    private long currentHubIdOf(long shipmentId) {
        Long hubId = tx.execute(status -> load(shipmentId).getCurrentHub().getId());
        if (hubId == null) {
            throw new NotFoundException("Shipment not found: " + shipmentId);
        }
        return hubId;
    }

    private Shipment load(long id) {
        return shipments.findWithDetails(id).orElseThrow(() -> new NotFoundException("Shipment not found: " + id));
    }

    private Hub hub(Long id) {
        return hubs.findById(id).orElseThrow(() -> new NotFoundException("Hub not found: " + id));
    }

    private static void ensureDifferent(Hub origin, Hub destination) {
        if (origin.getId().equals(destination.getId())) {
            throw new BusinessException("Origin and destination hubs must differ");
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String blankToNull(String s) {
        return isBlank(s) ? null : s.trim();
    }
}
