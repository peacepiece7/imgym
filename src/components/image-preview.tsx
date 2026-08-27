"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ImagePreviewProps {
  title: string;
  src: string;
  badge: string;
  alt: string;
}

export function ImagePreview({ title, src, badge, alt }: ImagePreviewProps) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Badge variant="outline" className="font-mono font-normal uppercase">
          {badge}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-[repeating-conic-gradient(oklch(0.25_0_0)_0_25%,oklch(0.2_0_0)_0_50%)_0/20px_20px]">
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            unoptimized
            className="object-contain p-4"
          />
        </div>
      </CardContent>
    </Card>
  );
}
