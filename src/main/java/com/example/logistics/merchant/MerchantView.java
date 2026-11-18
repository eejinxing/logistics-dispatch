package com.example.logistics.merchant;

import com.example.logistics.hub.HubRef;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record MerchantView(
        Long id,
        String code,
        String name,
        String contactName,
        String phone,
        HubRef defaultHub,
        boolean active,
        Instant createdAt,
        long shipments,
        long activeShipments,
        BigDecimal revenue30d,
        List<String> usernames) {

    public static MerchantView from(Merchant m, long shipments, long active, BigDecimal revenue30d,
                                    List<String> usernames) {
        return new MerchantView(m.getId(), m.getCode(), m.getName(), m.getContactName(), m.getPhone(),
                HubRef.from(m.getDefaultHub()), m.isActive(), m.getCreatedAt(), shipments, active, revenue30d,
                usernames);
    }
}
