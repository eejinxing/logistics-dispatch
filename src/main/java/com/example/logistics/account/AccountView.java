package com.example.logistics.account;

import com.example.logistics.merchant.Merchant;

import java.time.Instant;

public record AccountView(
        Long id,
        String username,
        Role role,
        String roleLabel,
        String displayName,
        Long merchantId,
        String merchantName,
        String phone,
        boolean enabled,
        Instant createdAt,
        Instant lastLoginAt) {

    public static AccountView from(AppUser u) {
        Merchant m = u.getMerchant();
        return new AccountView(u.getId(), u.getUsername(), u.getRole(), u.getRole().label(), u.getDisplayName(),
                m == null ? null : m.getId(), m == null ? null : m.getName(), u.getPhone(), u.isEnabled(),
                u.getCreatedAt(), u.getLastLoginAt());
    }
}
