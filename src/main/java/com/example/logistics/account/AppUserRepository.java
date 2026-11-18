package com.example.logistics.account;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Transactional(readOnly = true)
public interface AppUserRepository extends JpaRepository<AppUser, Long> {
    @Query("select u from AppUser u left join fetch u.merchant where lower(u.username) = lower(:username)")
    Optional<AppUser> findForLogin(@Param("username") String username);

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByPhoneKey(String phoneKey);

    @Query("select u from AppUser u left join fetch u.merchant order by u.role, u.id")
    List<AppUser> findAllWithMerchant();

    @Query("select u.merchant.id, u.username from AppUser u where u.merchant is not null")
    List<Object[]> merchantUsernames();

    @Modifying
    @Transactional
    @Query("delete from AppUser u where u.role <> com.example.logistics.account.Role.ADMIN")
    int deleteNonAdmins();
}
