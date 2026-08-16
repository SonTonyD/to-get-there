import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export type MessagingMode='inbox'|'conversation'|'settings';

@Component({
  selector:'app-messaging-domain',
  standalone:true,
  imports:[CommonModule,FormsModule],
  templateUrl:'./messaging-domain.component.html',
  styleUrl:'./messaging-domain.component.css'
})
export class MessagingDomainComponent {
  @Input({required:true}) mode:MessagingMode='inbox';
  @Input() userId='';
  @Input() inbox:any[]=[];
  @Input() requests:any[]=[];
  @Input() messages:any[]=[];
  @Input() peer:any=null;
  @Input() loading=false;
  @Input() sending=false;
  @Input() actionError:any=null;
  @Input() draft='';
  @Input() permission:'everyone'|'following'|'friends'|'nobody'='everyone';

  @Output() settingsRequested=new EventEmitter<void>();
  @Output() retryRequested=new EventEmitter<void>();
  @Output() conversationRequested=new EventEmitter<string>();
  @Output() inboxRequested=new EventEmitter<void>();
  @Output() hideRequested=new EventEmitter<void>();
  @Output() answerRequested=new EventEmitter<{id:string;status:'accepted'|'rejected'}>();
  @Output() reportRequested=new EventEmitter<string>();
  @Output() draftChange=new EventEmitter<string>();
  @Output() sendRequested=new EventEmitter<void>();
  @Output() permissionChange=new EventEmitter<'everyone'|'following'|'friends'|'nobody'>();
  @Output() permissionSaveRequested=new EventEmitter<void>();

  peerFor(item:any){return item?.conversation?.members?.find((member:any)=>member.user_id!==this.userId)?.profile??null}
  unreadFor(item:any){return item?.conversation?.messages?.filter((message:any)=>message.sender_id!==this.userId&&!message.read).length??0}
}
