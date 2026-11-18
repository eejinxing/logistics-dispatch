package com.example.logistics.shipment;

import com.example.logistics.geo.Direction;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import jakarta.validation.constraints.Size;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public record ShipmentFilter(
        ShipmentStatus status,
        Boolean active,
        Long originId,
        Long destinationId,
        Direction direction,
        Priority priority,
        Boolean late,
        @Size(max = 40) String q,
        Long merchantId,
        List<ShipmentStatus> statuses,
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {

    public Specification<Shipment> toSpecification(Instant now, ZoneId zone) {
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();
            if (merchantId != null) {
                where.add(cb.equal(root.get("merchant").get("id"), merchantId));
            }
            if (status != null) {
                where.add(cb.equal(root.get("status"), status));
            }
            if (statuses != null && !statuses.isEmpty()) {
                where.add(root.get("status").in(statuses));
            }
            if (from != null) {
                where.add(cb.greaterThanOrEqualTo(root.get("createdAt"), from.atStartOfDay(zone).toInstant()));
            }
            if (to != null) {
                where.add(cb.lessThan(root.get("createdAt"), to.plusDays(1).atStartOfDay(zone).toInstant()));
            }
            if (Boolean.TRUE.equals(active)) {
                where.add(root.get("status").in(ShipmentStatus.ACTIVE));
            }
            if (originId != null) {
                where.add(cb.equal(root.get("origin").get("id"), originId));
            }
            if (destinationId != null) {
                where.add(cb.equal(root.get("destination").get("id"), destinationId));
            }
            if (direction != null) {
                where.add(cb.equal(root.get("direction"), direction));
            }
            if (priority != null) {
                where.add(cb.equal(root.get("priority"), priority));
            }
            if (Boolean.TRUE.equals(late)) {
                where.add(root.get("status").in(ShipmentStatus.ACTIVE));
                where.add(cb.lessThan(root.get("promisedBy"), now));
            }
            if (q != null && !q.isBlank()) {
                String like = "%" + q.trim().toLowerCase(Locale.ROOT) + "%";
                where.add(cb.or(
                        cb.like(cb.lower(root.get("trackingNo")), like),
                        cb.like(cb.lower(root.get("receiverName")), like),
                        cb.like(cb.lower(root.get("senderName")), like),
                        cb.like(cb.lower(root.join("trip", JoinType.LEFT).get("code")), like)));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
    }
}
