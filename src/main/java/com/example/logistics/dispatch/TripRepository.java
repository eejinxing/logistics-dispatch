package com.example.logistics.dispatch;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Transactional(readOnly = true)
public interface TripRepository extends JpaRepository<Trip, Long> {
    @Query("""
            select t from Trip t join fetch t.vehicle join fetch t.origin join fetch t.destination
            where t.status in :statuses order by t.departAt""")
    List<Trip> findWithDetailsByStatusIn(@Param("statuses") Collection<TripStatus> statuses);

    @Query("""
            select t from Trip t join fetch t.vehicle join fetch t.origin join fetch t.destination
            where t.status = com.example.logistics.dispatch.TripStatus.ARRIVED order by t.arrivedAt desc""")
    List<Trip> findRecentlyArrived(Pageable pageable);

    @Query("select t from Trip t join fetch t.vehicle join fetch t.origin join fetch t.destination where t.id = :id")
    Optional<Trip> findWithDetails(@Param("id") long id);

    @Query("select t.id, t.origin.id from Trip t where t.status = :status and t.departAt <= :now")
    List<Object[]> findDueToDepart(@Param("status") TripStatus status, @Param("now") Instant now);

    @Query("select t.id, t.destination.id from Trip t where t.status = :status and t.arriveAt <= :now")
    List<Object[]> findDueToArrive(@Param("status") TripStatus status, @Param("now") Instant now);

    @Query("""
            select t from Trip t join fetch t.origin join fetch t.destination
            where t.vehicle.id = :vehicleId and t.status <> com.example.logistics.dispatch.TripStatus.ARRIVED""")
    Optional<Trip> findActiveForVehicle(@Param("vehicleId") long vehicleId);

    @Query("""
            select count(t) > 0 from Trip t where t.relocation = true and t.destination.id = :hubId
            and t.vehicle.type in :types and t.status <> com.example.logistics.dispatch.TripStatus.ARRIVED""")
    boolean relocationUnderway(@Param("hubId") long hubId,
                               @Param("types") Collection<com.example.logistics.vehicle.VehicleType> types);

    @Query("select coalesce(max(t.id), 0) from Trip t")
    long maxId();
}
