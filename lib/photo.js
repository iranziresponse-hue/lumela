"use client";

import { PHOTO_BUCKET } from "@/lib/constants";
import { supabase } from "@/lib/supabase";

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.7;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function compressImage(file) {
  // createImageBitmap + imageOrientation: "from-image" applies the file's
  // EXIF orientation before we ever touch a canvas. Drawing straight onto
  // canvas with drawImage() ignores that tag, so portrait phone photos
  // would otherwise come out sideways after compression.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Photo compression failed"))),
        "image/jpeg",
        JPEG_QUALITY
      );
    });
  } finally {
    bitmap.close();
  }
}

export async function uploadReportPhoto(reportId, file) {
  const blob = await compressImage(file);

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Photo too large");
  }

  const path = `${reportId}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
