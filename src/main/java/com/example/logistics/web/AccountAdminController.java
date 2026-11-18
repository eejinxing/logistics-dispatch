package com.example.logistics.web;

import com.example.logistics.account.AccountService;
import com.example.logistics.account.AccountView;
import com.example.logistics.merchant.MerchantService;
import com.example.logistics.merchant.MerchantView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class AccountAdminController {
    private final MerchantService merchants;
    private final AccountService accounts;

    public AccountAdminController(MerchantService merchants, AccountService accounts) {
        this.merchants = merchants;
        this.accounts = accounts;
    }

    public record EnabledRequest(@NotNull Boolean enabled) {
    }

    @GetMapping("/api/merchants")
    public List<MerchantView> merchants() {
        return merchants.list();
    }

    @PostMapping("/api/merchants")
    @ResponseStatus(HttpStatus.CREATED)
    public MerchantView createMerchant(@Valid @RequestBody MerchantService.CreateMerchantRequest request) {
        return merchants.create(request);
    }

    @PatchMapping("/api/merchants/{id}")
    public MerchantView setMerchantActive(@PathVariable long id, @Valid @RequestBody EnabledRequest request) {
        return merchants.setActive(id, request.enabled());
    }

    @GetMapping("/api/accounts")
    public List<AccountView> accounts() {
        return accounts.list();
    }

    @PatchMapping("/api/accounts/{id}")
    public AccountView setAccountEnabled(@PathVariable long id, @Valid @RequestBody EnabledRequest request) {
        return accounts.setEnabled(id, request.enabled());
    }
}
