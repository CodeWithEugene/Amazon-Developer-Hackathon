"use client"

import Link from "next/link"
import {
  ChevronRightIcon,
  MessageCircleQuestionIcon,
  ScanEyeIcon,
  VideoIcon,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

const LINKS = [
  {
    href: "/family/devices",
    title: "Device Check",
    description: "Confirm the doorbell is online and can see the walkway, and sync Ring history.",
    icon: ScanEyeIcon,
  },
  {
    href: "/family/live",
    title: "Live View",
    description: "Open a short live view from the front door doorbell.",
    icon: VideoIcon,
  },
  {
    href: "/ask",
    title: "Ask VisitProof",
    description: "Ask by voice or text whether the caregiver came today.",
    icon: MessageCircleQuestionIcon,
  },
] as const

export function FamilyLinks() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Doorbell</CardTitle>
        <CardDescription>Everything VisitProof uses, in one place.</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2">
          {LINKS.map((link) => {
            const Icon = link.icon
            return (
              <Item key={link.href} variant="outline" render={<Link href={link.href} />}>
                <ItemMedia variant="icon">
                  <Icon aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{link.title}</ItemTitle>
                  <ItemDescription>{link.description}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ChevronRightIcon aria-hidden="true" />
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
