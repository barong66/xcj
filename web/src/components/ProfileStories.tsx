import Image from "next/image";
import Link from "next/link";
import { getAccounts } from "@/lib/api";

export async function ProfileStories() {
  let accounts;
  try {
    accounts = await getAccounts();
  } catch {
    return null;
  }

  if (!accounts || accounts.length === 0) return null;

  return (
    <div className="border-b border-border">
      <div className="flex gap-3 px-4 py-3 overflow-x-auto">
        {accounts.map((account) => {
          const slug = account.slug || account.username;
          const name = account.display_name || account.username;

          return (
            <Link
              key={account.id}
              href={`/model/${slug}`}
              className="flex flex-col items-center gap-1 shrink-0"
            >
              <div className="w-[56px] h-[56px] rounded-full p-[2px] bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400">
                <div className="w-full h-full rounded-full overflow-hidden bg-bg ring-2 ring-bg">
                  <Image
                    src={account.avatar_url}
                    alt={name}
                    width={52}
                    height={52}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <span className="text-[10px] text-txt-muted w-[60px] text-center truncate">
                {name}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
