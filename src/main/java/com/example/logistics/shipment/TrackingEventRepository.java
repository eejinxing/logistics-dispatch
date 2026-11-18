package com.example.logistics.shipment;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Transactional(readOnly = true)
public interface TrackingEventRepository extends JpaRepository<TrackingEvent, Long> {
    @Query("select e from TrackingEvent e where e.shipment.id = :shipmentId order by e.occurredAt asc, e.id asc")
    List<TrackingEvent> findTimeline(@Param("shipmentId") long shipmentId);

    @Query("""
            select e.occurredAt from TrackingEvent e
            where e.status = :status and e.occurredAt between :start and :end""")
    List<Instant> occurrenceTimes(@Param("status") ShipmentStatus status, @Param("start") Instant start,
                                  @Param("end") Instant end);

    @Query("""
            select e from TrackingEvent e join fetch e.shipment s join fetch s.origin join fetch s.destination
            order by e.occurredAt desc, e.id desc""")
    List<TrackingEvent> findRecent(Pageable pageable);
}
