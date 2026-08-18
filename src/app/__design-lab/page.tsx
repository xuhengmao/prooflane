import { notFound } from "next/navigation"
import { DesignLab } from "@/components/design-lab/design-lab"

export default function DesignLabPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }
  return <DesignLab />
}
