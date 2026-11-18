package com.example.logistics.web;

import com.example.logistics.account.AccountService;
import com.example.logistics.account.AccountView;
import com.example.logistics.account.AppUserPrincipal;
import com.example.logistics.concurrent.RateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class AuthController {
    private final AccountService accounts;
    private final RateLimiter registrations = new RateLimiter(5, 60_000);

    public AuthController(AccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping("/api/me")
    public Map<String, Object> me(@AuthenticationPrincipal AppUserPrincipal me, Principal principal) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (me == null) {
            body.put("username", principal.getName());
            body.put("role", "ADMIN");
            return body;
        }
        body.put("username", me.getUsername());
        body.put("role", me.role());
        body.put("roleLabel", me.role().label());
        body.put("displayName", me.displayName());
        body.put("home", me.role().home());
        body.put("merchantId", me.merchantId());
        return body;
    }

    @PostMapping("/api/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AccountView register(@Valid @RequestBody AccountService.RegisterCustomerRequest request,
                                HttpServletRequest http) {
        registrations.check(http.getRemoteAddr());
        return accounts.registerCustomer(request);
    }
}
