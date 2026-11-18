package com.example.logistics.config;

import com.example.logistics.account.AccountService;
import com.example.logistics.account.AppUserPrincipal;
import com.example.logistics.account.Role;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
public class SecurityConfig {
    public static final String ROLE_ADMIN = Role.ADMIN.name();

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AccountService accounts) throws Exception {
        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/login.html", "/register.html", "/css/**", "/favicon.svg", "/error",
                                "/actuator/health", "/actuator/health/**",
                                "/api/public/**", "/api/auth/register").permitAll()
                        .requestMatchers("/merchant.html", "/api/merchant/**").hasRole(Role.MERCHANT.name())
                        .requestMatchers("/customer.html", "/api/customer/**").hasRole(Role.CUSTOMER.name())
                        .requestMatchers("/js/**", "/api/me", "/api/network/**").authenticated()
                        .anyRequest().hasRole(ROLE_ADMIN))
                .formLogin(form -> form
                        .loginPage("/login.html")
                        .loginProcessingUrl("/api/auth/login")
                        .successHandler((req, res, auth) -> {
                            Role role = roleOf(auth);
                            if (auth.getPrincipal() instanceof AppUserPrincipal p) {
                                accounts.recordLogin(p.userId());
                            }
                            res.setStatus(HttpServletResponse.SC_OK);
                            res.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            res.getWriter().write("{\"role\":\"" + (role == null ? "" : role.name())
                                    + "\",\"home\":\"" + (role == null ? "/login.html" : role.home()) + "\"}");
                        })
                        .failureHandler((req, res, ex) -> writeProblem(res, HttpServletResponse.SC_UNAUTHORIZED,
                                "Sign-in failed", ex instanceof org.springframework.security.authentication.DisabledException
                                        ? "This account is disabled. Contact an administrator." : "Incorrect username or password"))
                        .permitAll())
                .logout(logout -> logout
                        .logoutUrl("/api/auth/logout")
                        .logoutSuccessHandler((req, res, auth) -> res.setStatus(HttpServletResponse.SC_NO_CONTENT)))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler()))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(entryPoint())
                        .accessDeniedHandler(accessDenied()))
                .headers(headers -> headers.frameOptions(frame -> frame.deny()));
        return http.build();
    }

    private static AuthenticationEntryPoint entryPoint() {
        return (request, response, authException) -> {
            if (request.getRequestURI().startsWith("/api/")) {
                writeProblem(response, HttpServletResponse.SC_UNAUTHORIZED, "Sign-in required", "Sign in to continue");
            } else {
                response.sendRedirect("/login.html");
            }
        };
    }

    private static AccessDeniedHandler accessDenied() {
        return (request, response, ex) -> {
            if (request.getRequestURI().startsWith("/api/")) {
                writeProblem(response, HttpServletResponse.SC_FORBIDDEN, "Access denied", "Your account does not have permission to perform this action");
                return;
            }
            Role role = roleOf(SecurityContextHolder.getContext().getAuthentication());
            response.sendRedirect(role == null ? "/login.html" : role.home());
        };
    }

    private static Role roleOf(Authentication auth) {
        if (auth == null) {
            return null;
        }
        for (Role role : Role.values()) {
            if (auth.getAuthorities().stream().anyMatch(a -> role.authority().equals(a.getAuthority()))) {
                return role;
            }
        }
        return null;
    }

    private static void writeProblem(HttpServletResponse response, int status, String title, String detail)
            throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(
                "{\"status\":" + status + ",\"title\":\"" + title + "\",\"detail\":\"" + detail + "\"}");
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }
}
