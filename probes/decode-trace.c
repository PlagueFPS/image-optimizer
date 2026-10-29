#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <libheif/heif.h>
struct heif_error heif_decode_image(const struct heif_image_handle *h, struct heif_image **im,
                                    enum heif_colorspace color, enum heif_chroma chroma,
                                    const struct heif_decoding_options *options) {
    struct heif_error (*real)(const struct heif_image_handle *, struct heif_image **, enum heif_colorspace, enum heif_chroma, const struct heif_decoding_options *)=dlsym(RTLD_NEXT,"heif_decode_image");
    fprintf(stderr,"probe heif_decode_image color=%d chroma=%d\n",color,chroma);
    return real(h,im,color,chroma,options);
}

#include <dav1d/dav1d.h>
int dav1d_open(Dav1dContext **context, const Dav1dSettings *settings) {
    int (*real)(Dav1dContext **, const Dav1dSettings *) = dlsym(RTLD_NEXT, "dav1d_open");
    fprintf(stderr, "probe dav1d_open threads=%d frame_delay=%d\n", settings->n_threads, settings->max_frame_delay);
    return real(context, settings);
}

#include <aom/aom_decoder.h>
aom_codec_err_t aom_codec_dec_init_ver(aom_codec_ctx_t *context, aom_codec_iface_t *iface,
                                      const aom_codec_dec_cfg_t *config,
                                      aom_codec_flags_t flags, int version) {
    void *library = dlopen("libaom.so.3", RTLD_LAZY | RTLD_NOLOAD);
    if (!library) {
        fprintf(stderr, "probe libaom lookup failed: %s\n", dlerror());
        abort();
    }
    aom_codec_err_t (*real)(aom_codec_ctx_t *, aom_codec_iface_t *, const aom_codec_dec_cfg_t *, aom_codec_flags_t, int) = dlsym(library, "aom_codec_dec_init_ver");
    if (!real) abort();
    fprintf(stderr, "probe aom_codec_dec_init_ver threads=%u\n", config ? config->threads : 0);
    aom_codec_err_t result = real(context, iface, config, flags, version);
    dlclose(library);
    return result;
}
