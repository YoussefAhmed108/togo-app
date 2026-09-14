-- 012: space leaders. The owner can promote members to leader; leaders manage
-- membership (invite, remove members). The owner still counts as a leader.

ALTER TABLE space_members
  MODIFY role ENUM('owner', 'leader', 'member') NOT NULL DEFAULT 'member';
