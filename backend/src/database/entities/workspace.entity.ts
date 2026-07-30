import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';

@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slackWorkspaceId: string;

  @Column()
  slackWorkspaceName: string;

  @Column({ type: 'text' })
  botToken: string;

  @CreateDateColumn()
  installedAt: Date;
}