import SearchBox from '@/components/chat/search-box'

export default function ChatIndexPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-3">
        <SearchBox align="left" />
      </div>
      <div className="flex flex-1 items-center justify-center text-gray-500">
        <p>Select a conversation — or create a channel to get started.</p>
      </div>
    </div>
  )
}
