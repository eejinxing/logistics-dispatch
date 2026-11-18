package com.example.logistics.common;

import org.springframework.data.domain.Page;

import java.util.List;
import java.util.function.Function;

public record PageView<T>(List<T> items, int page, int size, long total, int totalPages) {
    public static <E, T> PageView<T> of(Page<E> page, Function<E, T> mapper) {
        return new PageView<>(page.getContent().stream().map(mapper).toList(),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }
}
