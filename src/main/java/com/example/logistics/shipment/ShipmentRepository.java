package com.example.logistics.shipment;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Transactional(readOnly = true)
public interface ShipmentRepository extends JpaRepository<Shipment, Long>, JpaSpecificationExecutor<Shipment> {

    @Override
    @EntityGraph(attributePaths = {"origin", "destination", "currentHub", "merchant", "trip", "trip.vehicle"})
    Page<Shipment> findAll(Specification<Shipment> spec, Pageable pageable);

    @EntityGraph(attributePaths = {"origin", "destination", "currentHub", "merchant", "trip", "trip.vehicle"})
    Optional<Shipment> findByTrackingNo(String trackingNo);

    @EntityGraph(attributePaths = {"origin", "destination", "currentHub", "merchant", "trip", "trip.vehicle"})
    @Query("select s from Shipment s where s.id = :id")
    Optional<Shipment> findWithDetails(@Param("id") long id);

    @EntityGraph(attributePaths = {"origin", "destination", "currentHub", "merchant", "trip"})
    @Query("select s from Shipment s where s.id in :ids")
    List<Shipment> findAllWithDetails(@Param("ids") Collection<Long> ids);

    @Query("""
            select s from Shipment s join fetch s.origin join fetch s.destination join fetch s.currentHub
            where s.status in :statuses and s.currentHub.id = :hubId order by s.statusChangedAt""")
    List<Shipment> findWaitingAt(@Param("hubId") long hubId, @Param("statuses") Collection<ShipmentStatus> statuses);

    @Query("""
            select s from Shipment s join fetch s.origin join fetch s.destination join fetch s.currentHub
            where s.status in :statuses order by s.statusChangedAt""")
    List<Shipment> findAllWaiting(@Param("statuses") Collection<ShipmentStatus> statuses);

    @Query("select distinct s.currentHub.id from Shipment s where s.status in :statuses")
    List<Long> findHubIdsWithWaiting(@Param("statuses") Collection<ShipmentStatus> statuses);

    @Query("select s.currentHub.id, count(s) from Shipment s where s.status in :statuses group by s.currentHub.id")
    List<Object[]> countWaitingByHub(@Param("statuses") Collection<ShipmentStatus> statuses);


    @Query("select s.status, count(s) from Shipment s group by s.status")
    List<Object[]> countByStatus();

    @Query("""
            select s.direction, count(s), coalesce(sum(s.weightKg), 0) from Shipment s
            where s.status in :statuses and (:originId is null or s.origin.id = :originId)
            group by s.direction""")
    List<Object[]> countByDirection(@Param("statuses") Collection<ShipmentStatus> statuses,
                                    @Param("originId") Long originId);

    @Query("""
            select s.origin.id, s.destination.id, s.direction, count(s), coalesce(sum(s.weightKg), 0) from Shipment s
            where s.status in :statuses and (:originId is null or s.origin.id = :originId)
            group by s.origin.id, s.destination.id, s.direction
            order by count(s) desc""")
    List<Object[]> laneVolumes(@Param("statuses") Collection<ShipmentStatus> statuses,
                               @Param("originId") Long originId, Pageable pageable);

    @Query("""
            select count(s), coalesce(sum(s.price), 0) from Shipment s
            where s.createdAt >= :since and s.status <> :excluded""")
    List<Object[]> createdSince(@Param("since") Instant since, @Param("excluded") ShipmentStatus excluded);

    @Query("""
            select count(s), coalesce(sum(case when s.deliveredAt <= s.promisedBy then 1 else 0 end), 0)
            from Shipment s where s.status = :delivered and s.deliveredAt >= :since""")
    List<Object[]> deliveredSince(@Param("since") Instant since, @Param("delivered") ShipmentStatus delivered);

    @Query("select count(s) from Shipment s where s.status in :statuses and s.promisedBy < :now")
    long countLate(@Param("statuses") Collection<ShipmentStatus> statuses, @Param("now") Instant now);

    @EntityGraph(attributePaths = {"origin", "destination", "currentHub", "merchant", "trip", "trip.vehicle"})
    @Query("select s from Shipment s where s.status in :statuses and s.promisedBy < :now order by s.promisedBy")
    List<Shipment> findLate(@Param("statuses") Collection<ShipmentStatus> statuses, @Param("now") Instant now,
                            Pageable pageable);

    @EntityGraph(attributePaths = {"origin", "destination", "currentHub", "merchant", "trip", "trip.vehicle"})
    @Query("select s from Shipment s where s.status = :status order by s.statusChangedAt desc")
    List<Shipment> findLatestWithStatus(@Param("status") ShipmentStatus status, Pageable pageable);

    @Query("""
            select s.id from Shipment s
            where s.status in :statuses and s.nextStepAt is not null and s.nextStepAt <= :now
            order by s.nextStepAt""")
    List<Long> findDueSteps(@Param("statuses") Collection<ShipmentStatus> statuses, @Param("now") Instant now,
                            Pageable pageable);

    @Query("""
            select s.trackingNo, s.origin.code, s.destination.code from Shipment s
            where s.status in :statuses and s.promisedBy > :from and s.promisedBy <= :to""")
    List<Object[]> findNewlyLate(@Param("statuses") Collection<ShipmentStatus> statuses,
                                 @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            select s.origin.id, s.status, count(s) from Shipment s
            where s.status in :statuses group by s.origin.id, s.status""")
    List<Object[]> countByOriginAndStatus(@Param("statuses") Collection<ShipmentStatus> statuses);

    @Query("select s.destination.id, count(s) from Shipment s where s.status in :statuses group by s.destination.id")
    List<Object[]> countByDestination(@Param("statuses") Collection<ShipmentStatus> statuses);

    @Query("""
            select s.createdAt, s.price, s.status, s.deliveredAt, s.promisedBy, s.direction,
                   s.origin.id, s.destination.id, s.weightKg
            from Shipment s where s.createdAt >= :since or s.deliveredAt >= :since""")
    List<Object[]> reportRows(@Param("since") Instant since);

    @Query("select coalesce(max(s.id), 0) from Shipment s")
    long maxId();
}
