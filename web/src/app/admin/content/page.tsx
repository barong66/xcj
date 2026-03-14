import { redirect } from "next/navigation";
export default function ContentRedirect() {
  redirect("/admin/accounts");
}
