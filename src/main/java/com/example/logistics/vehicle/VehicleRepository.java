package com.example.logistics.vehicle;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Transactional(readOnly = true)
public interface VehicleRepository extends JpaRepository<Vehicle, Long> {
    @Query("select v from Vehicle v join fetch v.hub order by v.id")
    List<Vehicle> findAllWithHub();

    @Query("select v from Vehicle v join fetch v.hub where v.hub.id = :hubId and v.status = :status order by v.capacityKg")
    List<Vehicle> findAtHub(@Param("hubId") long hubId, @Param("status") VehicleStatus status);

    @Query("select v from Vehicle v join fetch v.hub where v.status = :status")
    List<Vehicle> findByStatusWithHub(@Param("status") VehicleStatus status);

    @Query("select v.status, count(v) from Vehicle v group by v.status")
    List<Object[]> countByStatus();

    @Query("select v.hub.id, v.status, count(v) from Vehicle v group by v.hub.id, v.status")
    List<Object[]> countByHubAndStatus();

    boolean existsByPlateNoIgnoreCase(String plateNo);
}
