package com.example.logistics.common;

import com.example.logistics.dispatch.TripRepository;
import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.shipment.ShipmentRepository;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class CodeGenerator {
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyMMdd");

    private final AtomicLong shipmentSeq;
    private final AtomicLong tripSeq;
    private final AtomicLong merchantSeq;

    public CodeGenerator(ShipmentRepository shipments, TripRepository trips, MerchantRepository merchants) {
        this.shipmentSeq = new AtomicLong(shipments.maxId());
        this.tripSeq = new AtomicLong(trips.maxId());
        this.merchantSeq = new AtomicLong(merchants.maxId());
    }

    public String nextTrackingNo(Instant at, ZoneId zone) {
        return "MY" + DAY.format(at.atZone(zone)) + String.format("%06d", shipmentSeq.incrementAndGet());
    }

    public String nextTripCode() {
        return String.format("TR%05d", tripSeq.incrementAndGet());
    }

    public String nextMerchantCode() {
        return String.format("M%04d", merchantSeq.incrementAndGet());
    }
}
