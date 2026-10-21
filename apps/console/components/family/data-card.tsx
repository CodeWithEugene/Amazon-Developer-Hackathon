"use client"

import { useState } from "react"
import { DownloadIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { useApiAction } from "../use-api-action"

export function DataCard({ erased }: { erased: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Data</CardTitle>
        <CardDescription>
          Export everything, or delete the door record and cut the link in one tap.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          render={<a href="/api/family/data" download />}
          nativeButton={false}
        >
          <DownloadIcon data-icon="inline-start" aria-hidden="true" />
          Export My Data
        </Button>
        <DeleteEverythingDialog erased={erased} />
      </CardContent>
    </Card>
  )
}

function DeleteEverythingDialog({ erased }: { erased: boolean }) {
  const { busy, run } = useApiAction()
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="destructive" disabled={busy || erased} />}
      >
        <Trash2Icon data-icon="inline-start" aria-hidden="true" />
        {erased ? "Data Deleted" : "Delete Everything"}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Everything?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the doorbell link, stops sharing with the agency,
            and deletes every door event, snapshot, and note for this home.
            A signed record that a deletion happened is kept, with no
            personal data in it. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep My Data</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              void run("/api/family/data", {
                method: "DELETE",
                success: {
                  title: "Everything Deleted",
                  description:
                    "The door record, snapshots, and notes were deleted and the link was removed.",
                },
                failureTitle: "Could Not Delete",
              })
            }}
          >
            Delete Everything
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
