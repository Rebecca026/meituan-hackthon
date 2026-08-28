package com.meituan.route;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.nio.file.Path;

/**
 * Serve store images from the routeplan/images/ directory.
 * Maps /images/stores/photo-XXX-Y.jpg to routeplan/images/stores/photo-XXX-Y.jpg.
 */
@RestController
public class ImageController {

    private static final Path IMAGE_DIR = Path.of("routeplan", "images").toAbsolutePath();

    @GetMapping(value = "/images/stores/{filename:.+}", produces = {MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE})
    public Mono<Resource> getImage(@PathVariable String filename) {
        Path filePath = IMAGE_DIR.resolve("stores").resolve(filename);
        if (filePath.toFile().exists()) {
            return Mono.just(new FileSystemResource(filePath));
        }
        return Mono.empty();
    }
}
