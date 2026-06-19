package snapshotservice

type SnapshotService struct{}

func (s *SnapshotService) Ready() (bool, error) { return true, nil }
