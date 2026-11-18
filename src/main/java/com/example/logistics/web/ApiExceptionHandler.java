package com.example.logistics.web;

import com.example.logistics.common.BusinessException;
import com.example.logistics.common.NotFoundException;
import com.example.logistics.concurrent.BulkheadFullException;
import com.example.logistics.concurrent.LockTimeoutException;
import com.example.logistics.concurrent.RateLimitedException;
import org.springframework.dao.DataIntegrityViolationException;
import com.example.logistics.concurrent.Throwables;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.NonNull;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeoutException;
import java.util.stream.Collectors;

@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler({
            CompletionException.class, ExecutionException.class, NotFoundException.class, BusinessException.class,
            OptimisticLockingFailureException.class, LockTimeoutException.class, BulkheadFullException.class,
            RejectedExecutionException.class, TimeoutException.class})
    ResponseEntity<ProblemDetail> handleDomain(Exception ex) {
        Throwable cause = Throwables.unwrap(ex);

        if (cause instanceof NotFoundException) {
            return problem(HttpStatus.NOT_FOUND, "Not found", cause.getMessage(), null);
        }
        if (cause instanceof BusinessException) {
            return problem(HttpStatus.CONFLICT, "Action not allowed", cause.getMessage(), null);
        }
        if (cause instanceof OptimisticLockingFailureException) {
            return problem(HttpStatus.CONFLICT, "Data changed", "Another operation updated this record. Refresh and try again.", null);
        }
        if (cause instanceof LockTimeoutException) {
            return problem(HttpStatus.SERVICE_UNAVAILABLE, "Hub busy", "Dispatch is in progress at this hub. Try again shortly.", "1");
        }
        if (cause instanceof BulkheadFullException || cause instanceof RejectedExecutionException) {
            return problem(HttpStatus.SERVICE_UNAVAILABLE, "System busy", "The system is handling too many requests. Try again shortly.", "1");
        }
        if (cause instanceof TimeoutException) {
            return problem(HttpStatus.GATEWAY_TIMEOUT, "Request timed out", "The operation did not finish in time", null);
        }
        log.error("Unexpected failure", cause);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "Internal error", "An unexpected error occurred", null);
    }

    @ExceptionHandler(RateLimitedException.class)
    ResponseEntity<ProblemDetail> handleRateLimited(RateLimitedException ex) {
        return problem(HttpStatus.TOO_MANY_REQUESTS, "Too many requests", "Try again shortly", String.valueOf(ex.retryAfterSeconds()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ProblemDetail> handleDuplicate(DataIntegrityViolationException ex) {
        return problem(HttpStatus.CONFLICT, "Duplicate record", "A record with this username, phone number, or name already exists", null);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ProblemDetail> handleConstraint(ConstraintViolationException ex) {
        String detail = ex.getConstraintViolations().stream()
                .map(v -> v.getMessage())
                .sorted()
                .collect(Collectors.joining(";"));
        return problem(HttpStatus.BAD_REQUEST, "Invalid input", detail, null);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ProblemDetail> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return problem(HttpStatus.BAD_REQUEST, "Invalid input", "Parameter " + ex.getName() + " has an invalid value", null);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(@NonNull MethodArgumentNotValidException ex,
                                                                  @NonNull HttpHeaders headers,
                                                                  @NonNull HttpStatusCode status,
                                                                  @NonNull WebRequest request) {
        String detail = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> e.getDefaultMessage() == null ? e.getField() + " is invalid" : e.getDefaultMessage())
                .distinct()
                .sorted()
                .collect(Collectors.joining(";"));
        ProblemDetail body = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
        body.setTitle("Invalid input");
        return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_PROBLEM_JSON).body(body);
    }

    private static ResponseEntity<ProblemDetail> problem(HttpStatus status, String title, String detail,
                                                         String retryAfterSeconds) {
        ProblemDetail body = ProblemDetail.forStatusAndDetail(status, detail);
        body.setTitle(title);
        ResponseEntity.BodyBuilder response = ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON);
        if (retryAfterSeconds != null) {
            response.header(HttpHeaders.RETRY_AFTER, retryAfterSeconds);
        }
        return response.body(body);
    }
}
