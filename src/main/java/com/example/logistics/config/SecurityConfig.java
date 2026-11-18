package com.example.logistics.config;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static com.example.logistics.account.AppUser.ADMIN_ROLE;

@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(request -> request.getDispatcherType() == DispatcherType.ASYNC
                                && "/api/live".equals(request.getServletPath())).permitAll()
                        .requestMatchers("/login.html", "/css/**", "/favicon.svg", "/error",
                                "/actuator/health", "/actuator/health/**").permitAll()
                        .anyRequest().hasRole(ADMIN_ROLE))
                .formLogin(form -> form
                        .loginPage("/login.html")
                        .loginProcessingUrl("/api/auth/login")
                        .successHandler((req, res, auth) -> {
                            res.setStatus(HttpServletResponse.SC_OK);
                            res.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            res.getWriter().write("{\"role\":\"" + ADMIN_ROLE + "\",\"home\":\"/\"}");
                        })
                        .failureHandler((req, res, ex) -> writeProblem(res, HttpServletResponse.SC_UNAUTHORIZED,
                                "Sign-in failed", ex instanceof DisabledException
                                        ? "This account is disabled." : "Incorrect username or password"))
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
            response.sendRedirect("/login.html");
        };
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
