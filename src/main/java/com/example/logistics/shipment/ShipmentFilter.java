package com.example.logistics.shipment;

import com.example.logistics.geo.Direction;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;

import java.time.Instant;
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
        String q,
        Long merchantId) {

    public ShipmentFilter forMerchant(long id) {
        return new ShipmentFilter(status, active, originId, destinationId, direction, priority, late, q, id);
    }

    public Specification<Shipment> toSpecification(Instant now) {
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();
            if (merchantId != null) {
                where.add(cb.equal(root.get("merchant").get("id"), merchantId));
            }
            if (status != null) {
                where.add(cb.equal(root.get("status"), status));
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
