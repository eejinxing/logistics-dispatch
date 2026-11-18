package com.example.logistics.merchant;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Transactional(readOnly = true)
public interface MerchantRepository extends JpaRepository<Merchant, Long> {
    @Query("select m from Merchant m join fetch m.defaultHub order by m.id")
    List<Merchant> findAllWithHub();

    @Query("select m from Merchant m join fetch m.defaultHub where m.id = :id")
    Optional<Merchant> findWithHub(@Param("id") long id);

    @Query("""
            select new com.example.logistics.merchant.MerchantView(m.id, m.code, m.name, m.active)
            from Merchant m order by m.id""")
    List<MerchantView> findShipmentOptions();

    @Query("select coalesce(max(m.id), 0) from Merchant m")
    long maxId();
}
