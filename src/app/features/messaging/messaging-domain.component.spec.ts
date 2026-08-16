import { TestBed } from '@angular/core/testing';
import { MessagingDomainComponent } from './messaging-domain.component';

describe('MessagingDomainComponent',()=>{
  beforeEach(async()=>{await TestBed.configureTestingModule({imports:[MessagingDomainComponent]}).compileComponents()});

  it('finds the other conversation member',()=>{
    const fixture=TestBed.createComponent(MessagingDomainComponent);
    const messaging=fixture.componentInstance;messaging.userId='me';
    const peer={user_id:'them',profile:{username:'voyageuse'}};
    expect(messaging.peerFor({conversation:{members:[{user_id:'me'},peer]}})?.username).toBe('voyageuse');
  });

  it('counts only unread messages sent by the peer',()=>{
    const fixture=TestBed.createComponent(MessagingDomainComponent);
    const messaging=fixture.componentInstance;messaging.userId='me';
    const item={conversation:{messages:[{sender_id:'them',read:false},{sender_id:'them',read:true},{sender_id:'me',read:false}]}};
    expect(messaging.unreadFor(item)).toBe(1);
  });
});
