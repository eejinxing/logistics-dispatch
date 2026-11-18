package com.example.logistics.hub;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Transactional(readOnly = true)
public interface HubRepository extends JpaRepository<Hub, Long> {
    Optional<Hub> findByCodeIgnoreCase(String code);

    List<Hub> findAllByOrderByIdAsc();

    boolean existsByCodeIgnoreCase(String code);
}
